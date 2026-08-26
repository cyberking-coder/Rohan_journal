-- Phase 10 — community: leaderboard and shared setups.
--
-- Safe to re-run. Run in the Supabase SQL editor after billing.sql.
--
-- ── This feature inverts the rest of the schema ────────────────────────────
-- Every other table here answers "can this user see their own row?". This one
-- asks users to show each other things on purpose. That is a different threat
-- model, and three rules keep it from becoming a hole:
--
--   1. OPT-IN. Nothing is visible to anyone until the user publishes it. The
--      default for an existing account is invisible, and staying invisible
--      requires no action. A community feature that quietly enrolls people is
--      a privacy incident with a friendly name.
--
--   2. NO CURRENCY, EVER. The leaderboard ranks R-multiples and percentages.
--      Account size is not published, not returned by any function here, and
--      not derivable from what is. This is a privacy decision first, but it is
--      also the strongest anti-gaming measure available: there is nothing to
--      win by claiming a big account.
--
--   3. ONE DOOR. As in phase9.sql, `trades` gets no new policy. Cross-tenant
--      reads happen only inside SECURITY DEFINER functions that decide exactly
--      what leaves. One place to audit.
--
-- ── On honesty ─────────────────────────────────────────────────────────────
-- Manually entered trades are self-reported and cannot be verified. Rather
-- than pretend otherwise, every entry carries whether its trades came from
-- broker sync, and the UI says so. A leaderboard that implies verification it
-- does not have is worse than one that admits the limit.

-- ---------------------------------------------------------------------------
-- Community profile — the opt-in itself
-- ---------------------------------------------------------------------------
create table if not exists public.community_profiles (
  user_id       uuid primary key references auth.users (id) on delete cascade,

  -- Chosen, not derived. Deriving a handle from the email address would
  -- publish part of it, which is exactly what someone joining a public
  -- leaderboard under a pseudonym is trying to avoid.
  handle        text not null,
  bio           text,

  -- The two switches. Separate, because "I'll share a strategy write-up" and
  -- "rank me against strangers" are different appetites and bundling them
  -- forces the more exposed choice.
  on_leaderboard boolean not null default false,
  publishes      boolean not null default false,

  -- Set by a moderator, never by the user. A shadow-ban that the user can
  -- lift themselves is not one.
  suspended      boolean not null default false,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A handle is an identity others see; two people cannot share one.
  constraint community_handle_shape check (handle ~ '^[a-zA-Z0-9_]{3,20}$')
);

create unique index if not exists community_profiles_handle_idx
  on public.community_profiles (lower(handle));

comment on table public.community_profiles is
  'Opt-in to the community. Absent row = not participating, which is the default.';

alter table public.community_profiles enable row level security;

drop policy if exists "community - read own"   on public.community_profiles;
drop policy if exists "community - insert own" on public.community_profiles;
drop policy if exists "community - update own" on public.community_profiles;
drop policy if exists "community - delete own" on public.community_profiles;

-- Note what is NOT here: a policy letting users read each other's profiles.
-- Other people's handles arrive through the leaderboard function, which
-- returns only what it means to. A blanket read policy would expose the
-- suspended flag and let anyone enumerate every participant.
create policy "community - read own" on public.community_profiles
  for select using (auth.uid() = user_id);
create policy "community - insert own" on public.community_profiles
  for insert with check (auth.uid() = user_id and not suspended);
create policy "community - update own" on public.community_profiles
  for update using (auth.uid() = user_id)
  -- `suspended` is deliberately not protected by this clause alone — see the
  -- trigger below. WITH CHECK cannot compare against the OLD row.
  with check (auth.uid() = user_id);
create policy "community - delete own" on public.community_profiles
  for delete using (auth.uid() = user_id);

-- A user must not be able to un-suspend themselves. RLS can say who may write
-- the row; only a trigger can say which columns of it they may change.
create or replace function public.community_profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.suspended is distinct from old.suspended then
    -- The service role bypasses RLS but still fires triggers, so moderation
    -- goes through moderate_user() below rather than a direct update.
    raise exception 'suspended may not be changed here';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists community_profiles_guard on public.community_profiles;
create trigger community_profiles_guard
  before update on public.community_profiles
  for each row execute function public.community_profiles_guard();

-- ---------------------------------------------------------------------------
-- Shared setups — a published strategy write-up
-- ---------------------------------------------------------------------------
create table if not exists public.shared_setups (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,

  title        text not null,
  thesis       text not null,
  -- Tags reuse the same vocabulary as the journal (src/lib/tags.js), so a
  -- setup tagged 'fvg' is findable by someone who tags their own trades that
  -- way.
  tags         text[] not null default '{}',
  symbols      text[] not null default '{}',
  timeframe    text,

  -- The author's own stats for this setup, computed client-side and stored as
  -- a snapshot. NOT recomputed live, on purpose: a write-up says "this is how
  -- it went over these 60 trades", and silently updating those numbers later
  -- would rewrite a claim the author made at a point in time.
  --
  -- Every figure here is a ratio or a count. No currency — see rule 2.
  stat_trades      integer not null default 0,
  stat_win_rate    numeric,
  stat_profit_factor numeric,
  stat_expectancy_r  numeric,
  stat_from    timestamptz,
  stat_to      timestamptz,
  -- True only when every trade in the sample came from broker sync.
  stat_verified boolean not null default false,

  published    boolean not null default false,
  removed      boolean not null default false,   -- by moderation
  view_count   integer not null default 0,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint shared_setups_title_len check (char_length(title) between 3 and 120),
  constraint shared_setups_thesis_len check (char_length(thesis) between 20 and 4000),
  constraint shared_setups_tags_len check (array_length(tags, 1) is null or array_length(tags, 1) <= 12)
);

create index if not exists shared_setups_user_idx on public.shared_setups (user_id, created_at desc);
create index if not exists shared_setups_public_idx
  on public.shared_setups (published, removed, created_at desc);

alter table public.shared_setups enable row level security;

drop policy if exists "setups - read own"   on public.shared_setups;
drop policy if exists "setups - insert own" on public.shared_setups;
drop policy if exists "setups - update own" on public.shared_setups;
drop policy if exists "setups - delete own" on public.shared_setups;

-- Owner-only, exactly like everything else. Published setups reach other
-- people through browse_setups(), never through a policy on this table — the
-- same shape as phase9.sql, for the same reason.
create policy "setups - read own" on public.shared_setups
  for select using (auth.uid() = user_id);
create policy "setups - insert own" on public.shared_setups
  for insert with check (auth.uid() = user_id);
create policy "setups - update own" on public.shared_setups
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "setups - delete own" on public.shared_setups
  for delete using (auth.uid() = user_id);

-- A removed setup stays removed. Without this, moderation is advisory.
create or replace function public.shared_setups_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.removed is distinct from old.removed then
    raise exception 'removed may not be changed here';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists shared_setups_guard on public.shared_setups;
create trigger shared_setups_guard
  before update on public.shared_setups
  for each row execute function public.shared_setups_guard();

-- ---------------------------------------------------------------------------
-- Reports — the moderation path
-- ---------------------------------------------------------------------------
-- Shipping a place where users publish to each other without a way to report
-- what they find there is not a feature decision, it is a missing one.
create table if not exists public.content_reports (
  id            uuid primary key default gen_random_uuid(),
  -- Defaulted rather than sent by the client. The policy below would reject a
  -- forged one anyway, but a default means the client never handles another
  -- user's id at all, and one fewer place can get it wrong.
  reporter_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  setup_id      uuid references public.shared_setups (id) on delete cascade,
  reason        text not null check (reason in ('spam', 'misleading', 'abusive', 'impersonation', 'other')),
  detail        text,
  resolved      boolean not null default false,
  created_at    timestamptz not null default now(),

  -- One report per person per setup. Otherwise a single motivated user can
  -- manufacture the appearance of consensus.
  unique (reporter_id, setup_id)
);

alter table public.content_reports enable row level security;

drop policy if exists "reports - insert own" on public.content_reports;
drop policy if exists "reports - read own"   on public.content_reports;

create policy "reports - insert own" on public.content_reports
  for insert with check (auth.uid() = reporter_id);
-- Readable by the reporter only. Letting an author see who reported them is
-- how reporting stops being used.
create policy "reports - read own" on public.content_reports
  for select using (auth.uid() = reporter_id);
-- No update or delete: a report is a record, and a reporter who could delete
-- theirs could be pressured into it.

-- ---------------------------------------------------------------------------
-- The leaderboard
-- ---------------------------------------------------------------------------
-- Eligibility, stated once here rather than in the client, because the client
-- copy is for drawing the UI and this one decides.
--
-- The thresholds exist because a leaderboard's natural top is somebody with
-- four trades and a 100% win rate. That is noise presented as achievement, and
-- it is also the easiest thing in the world to manufacture.
create or replace function public.leaderboard(
  p_days int default 30,
  p_limit int default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  min_trades constant int := 20;
  min_days   constant int := 10;
  since      timestamptz := now() - make_interval(days => greatest(p_days, 1));
  payload    jsonb;
begin
  with participants as (
    select cp.user_id, cp.handle
    from public.community_profiles cp
    where cp.on_leaderboard and not cp.suspended
  ),
  scoped as (
    select
      p.user_id, p.handle,
      t.pnl - coalesce(t.fees, 0) as net,
      coalesce(t.source, 'manual') as source,
      coalesce(t.closed_at, t.traded_at) as at
    from participants p
    join public.trades t on t.user_id = p.user_id
    where coalesce(t.status, 'closed') <> 'open'
      and coalesce(t.closed_at, t.traded_at) >= since
  ),
  units as (
    -- The R unit: the average losing trade, per user. Dividing by it turns
    -- every figure into a risk multiple and removes account size entirely.
    select user_id, abs(avg(net)) as r_unit
    from scoped where net < 0
    group by user_id
  ),
  agg as (
    select
      s.user_id,
      s.handle,
      count(*) as trades,
      count(*) filter (where s.net > 0) as wins,
      count(distinct date_trunc('day', s.at)) as trading_days,
      sum(s.net) as total_net,
      sum(s.net) filter (where s.net > 0) as gross_win,
      abs(sum(s.net) filter (where s.net < 0)) as gross_loss,
      -- Verified only if EVERY trade in the window came from a broker sync.
      -- One manual entry and the badge is gone, because one manual entry is
      -- all it takes to change the answer.
      bool_and(s.source <> 'manual') as verified,
      max(u.r_unit) as r_unit
    from scoped s
    left join units u on u.user_id = s.user_id
    group by s.user_id, s.handle
  ),
  ranked as (
    select
      handle,
      trades,
      trading_days,
      verified,
      round((wins::numeric / nullif(trades, 0)) * 100, 1) as win_rate,
      case when gross_loss > 0 then round(gross_win / gross_loss, 2) else null end as profit_factor,
      -- Expectancy per trade, in R. This is the ranking column: it rewards an
      -- edge rather than a big account or a long lucky streak.
      case when r_unit > 0 then round((total_net / trades) / r_unit, 3) else null end as expectancy_r
    from agg
    where trades >= min_trades
      and trading_days >= min_days
      -- No losing trades at all over 20+ trades means the R unit is undefined.
      -- Excluded rather than given an infinite score, which would top the
      -- board permanently.
      and r_unit > 0
  )
  select jsonb_build_object(
    'periodDays', greatest(p_days, 1),
    'minTrades', min_trades,
    'minDays', min_days,
    'generatedAt', now(),
    'entries', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.expectancy_r desc nulls last)
      from (select * from ranked order by expectancy_r desc nulls last limit greatest(p_limit, 1)) r
    ), '[]'::jsonb)
  ) into payload;

  return payload;
end $$;

revoke all on function public.leaderboard(int, int) from public;
-- Signed-in users only. An anonymous leaderboard is a scraping target, and
-- participants opted into being seen by other traders, not by the internet.
grant execute on function public.leaderboard(int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Browsing setups
-- ---------------------------------------------------------------------------
create or replace function public.browse_setups(
  p_tag text default null,
  p_limit int default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare payload jsonb;
begin
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into payload
  from (
    select
      s.id, s.title, s.thesis, s.tags, s.symbols, s.timeframe,
      s.stat_trades, s.stat_win_rate, s.stat_profit_factor, s.stat_expectancy_r,
      s.stat_from, s.stat_to, s.stat_verified,
      s.created_at,
      cp.handle as author
    from public.shared_setups s
    join public.community_profiles cp on cp.user_id = s.user_id
    where s.published
      and not s.removed
      and not cp.suspended
      and (p_tag is null or s.tags @> array[p_tag])
    order by s.created_at desc
    limit greatest(p_limit, 1)
  ) x;

  return payload;
end $$;

revoke all on function public.browse_setups(text, int) from public;
grant execute on function public.browse_setups(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Moderation
-- ---------------------------------------------------------------------------
-- Called with the service role, from wherever you do operations — not exposed
-- to any client role. The triggers above make this the only way `suspended`
-- and `removed` can change.
create or replace function public.moderate_user(p_user uuid, p_suspended boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  alter table public.community_profiles disable trigger community_profiles_guard;
  update public.community_profiles set suspended = p_suspended, updated_at = now()
  where user_id = p_user;
  alter table public.community_profiles enable trigger community_profiles_guard;
end $$;

create or replace function public.moderate_setup(p_setup uuid, p_removed boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  alter table public.shared_setups disable trigger shared_setups_guard;
  update public.shared_setups set removed = p_removed, updated_at = now()
  where id = p_setup;
  alter table public.shared_setups enable trigger shared_setups_guard;
end $$;

revoke all on function public.moderate_user(uuid, boolean) from public;
revoke all on function public.moderate_setup(uuid, boolean) from public;
-- Deliberately granted to nobody. Run as the service role from the SQL editor
-- or an operations script. Granting these to `authenticated` would let any
-- user suspend any other.
