-- Phase 9 — shared read-only dashboards ("Trader POV").
--
-- Safe to re-run. Run in the Supabase SQL editor after phase8.sql.
--
-- ── The shape of the problem ───────────────────────────────────────────────
-- Every other table in this database answers "can this signed-in user see
-- their own row?". This feature asks the opposite: can a person who is NOT
-- signed in, and who owns nothing, see somebody else's trades?
--
-- The tempting implementation is a policy on `trades` that also allows reads
-- when a valid share code is present. That reopens the hole the rest of the
-- schema exists to close: one mistake in that policy and every trade in the
-- database is public.
--
-- So the trades table is not touched at all. `shared_dashboards` is owner-only
-- like everything else, and the ONLY way to read another user's data is one
-- SECURITY DEFINER function that takes a code, validates it, and returns
-- exactly the fields the owner enabled. One function to audit, one place where
-- the rules live, and no anonymous read policy on anything.

create table if not exists public.shared_dashboards (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users (id) on delete cascade,

  -- The secret. Unguessable rather than short: this is a bearer token in a
  -- URL, so its only protection is its length. See `new_share_code()`.
  code           text not null unique,
  label          text not null default 'Shared view',

  -- null = every account. Otherwise one broker account, so a prop-firm
  -- challenge can be shared without the personal account beside it.
  account_scope  uuid references public.broker_accounts (id) on delete cascade,

  -- Which parts the viewer gets. Anything not listed is never returned by the
  -- function — not hidden in the UI, not returned at all.
  sections       text[] not null default array['overview','performance','trades'],

  -- Share the shape of the results without the size of the account. P&L comes
  -- back in R multiples (each trade divided by the average losing trade)
  -- rather than currency, which is how traders normally publish results.
  hide_amounts   boolean not null default false,

  expires_at     timestamptz,
  revoked        boolean not null default false,

  view_count     integer not null default 0,
  last_viewed_at timestamptz,
  created_at     timestamptz not null default now()
);

comment on table public.shared_dashboards is
  'Read-only share links. Viewers reach data only through shared_view(), never through table policies.';

create index if not exists shared_dashboards_owner_idx
  on public.shared_dashboards (owner_user_id, created_at desc);
create unique index if not exists shared_dashboards_code_idx
  on public.shared_dashboards (code);

-- ---------------------------------------------------------------------------
-- Row Level Security — owner only, exactly like every other table
-- ---------------------------------------------------------------------------
alter table public.shared_dashboards enable row level security;

drop policy if exists "shares - read own" on public.shared_dashboards;
drop policy if exists "shares - insert own" on public.shared_dashboards;
drop policy if exists "shares - update own" on public.shared_dashboards;
drop policy if exists "shares - delete own" on public.shared_dashboards;

create policy "shares - read own" on public.shared_dashboards
  for select using (auth.uid() = owner_user_id);
create policy "shares - insert own" on public.shared_dashboards
  for insert with check (auth.uid() = owner_user_id);
create policy "shares - update own" on public.shared_dashboards
  for update using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
create policy "shares - delete own" on public.shared_dashboards
  for delete using (auth.uid() = owner_user_id);

-- ---------------------------------------------------------------------------
-- Code generation
-- ---------------------------------------------------------------------------
-- The spec sketches `VIEW-XXXXXX`. Six characters is about 2 billion
-- possibilities, which sounds like plenty and isn't: an attacker guessing over
-- HTTP works through that in days, and every hit is somebody's whole trading
-- history. These links are shared by copying, never by typing, so length costs
-- nothing.
--
-- 16 characters from a 32-symbol alphabet is 2^80. The alphabet omits I, L, O,
-- U and 0/1 so a code read aloud or copied by hand isn't ambiguous.
create or replace function public.new_share_code() returns text
language plpgsql as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  out text := '';
  i int;
begin
  for i in 1..16 loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return 'VIEW-' || substr(out,1,4) || '-' || substr(out,5,4) || '-' ||
         substr(out,9,4) || '-' || substr(out,13,4);
end $$;

-- ---------------------------------------------------------------------------
-- The one door
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, so it runs with the owner's rights and can read the
-- trades a caller cannot. Everything it returns is therefore a deliberate
-- decision made here.
--
-- Deliberately NOT returned, whatever the sections say:
--   • the owner's email or user id
--   • broker account numbers or server names
--   • screenshot paths — those live in a private bucket and an anonymous
--     viewer could never sign a URL for them anyway
--   • anything belonging to any other user
create or replace function public.shared_view(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  share      public.shared_dashboards%rowtype;
  wants_journal boolean;
  r_unit     numeric;
  payload    jsonb;
begin
  select * into share from public.shared_dashboards
  where code = p_code and not revoked
    and (expires_at is null or expires_at > now());

  -- One answer for "no such code", "revoked" and "expired". Distinguishing
  -- them would confirm to a guesser that a code once existed.
  if not found then
    return null;
  end if;

  wants_journal := 'journal' = any(share.sections);

  -- The R unit: the average losing trade. Dividing by it expresses results in
  -- risk multiples, which is meaningful to a reader and says nothing about how
  -- large the account is.
  if share.hide_amounts then
    select abs(avg(pnl - coalesce(fees,0))) into r_unit
    from public.trades
    where user_id = share.owner_user_id
      and (share.account_scope is null or broker_account_id = share.account_scope)
      and coalesce(status,'closed') <> 'open'
      and (pnl - coalesce(fees,0)) < 0;
    -- No losses yet, or all break-even: fall back to 1 so the maths stays
    -- defined. The UI says the unit is approximate.
    if r_unit is null or r_unit = 0 then r_unit := 1; end if;
  end if;

  select jsonb_build_object(
    'label', share.label,
    'sections', to_jsonb(share.sections),
    'hideAmounts', share.hide_amounts,
    'unit', case when share.hide_amounts then 'R' else 'money' end,
    'createdAt', share.created_at,
    'expiresAt', share.expires_at,
    'trades', coalesce((
      select jsonb_agg(t order by t.traded_at)
      from (
        select
          -- A stable per-share id. The real row id is withheld: it is a key
          -- into a table the viewer must never address directly.
          md5(tr.id::text || share.code) as id,
          tr.symbol, tr.side, tr.strategy, tr.session, tr.status,
          tr.traded_at, tr.opened_at, tr.closed_at,
          case when share.hide_amounts
               then round((tr.pnl - coalesce(tr.fees,0)) / r_unit, 3)
               else tr.pnl end as pnl,
          case when share.hide_amounts then 0 else tr.fees end as fees,
          case when share.hide_amounts then 0 else tr.swap end as swap,
          -- Prices reveal nothing about account size and are what makes the
          -- trades readable, so they stay.
          tr.entry, tr.exit, tr.stop_loss, tr.take_profit, tr.rr,
          case when share.hide_amounts then null else tr.qty end as qty,
          -- The phase 3 journal fields, by their real names.
          case when wants_journal then tr.pre_trade_analysis else null end as pre_trade_analysis,
          case when wants_journal then tr.post_trade_review else null end as post_trade_review,
          case when wants_journal then tr.lessons_learned else null end as lessons_learned,
          case when wants_journal then tr.emotions else null end as emotions,
          case when wants_journal then tr.notes else null end as notes,
          case when wants_journal then tr.journal_rating else null end as journal_rating
        from public.trades tr
        where tr.user_id = share.owner_user_id
          and (share.account_scope is null or tr.broker_account_id = share.account_scope)
      ) t
    ), '[]'::jsonb),
    'reports', case when 'reports' = any(share.sections) then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', md5(ar.id::text || share.code),
        'title', ar.title, 'summary', ar.summary, 'sections', ar.sections,
        'createdAt', ar.created_at, 'tradeCount', ar.trade_count
      ) order by ar.created_at desc)
      from public.ai_reports ar where ar.user_id = share.owner_user_id
    ), '[]'::jsonb) else '[]'::jsonb end
  ) into payload;

  -- Counted after the payload is built, so a failed read isn't recorded as a
  -- view. Not in a trigger: the owner should see genuine reads only.
  update public.shared_dashboards
  set view_count = view_count + 1, last_viewed_at = now()
  where id = share.id;

  return payload;
end $$;

-- Anonymous callers may run the function. They still cannot read any table.
revoke all on function public.shared_view(text) from public;
grant execute on function public.shared_view(text) to anon, authenticated;
grant execute on function public.new_share_code() to authenticated;
