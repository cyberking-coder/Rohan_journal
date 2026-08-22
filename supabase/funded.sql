-- Funded / prop-firm challenge tracking — Master PRD §31–32.
--
-- Safe to re-run. Run in the Supabase SQL editor after phase9.sql.
--
-- ── What this table is, and what it deliberately is not ────────────────────
-- It stores the *rules* of a challenge and nothing else. No balance, no
-- status, no drawdown, no pass/fail. Every one of those is computed from the
-- trades by src/lib/funded.js.
--
-- Storing them would mean two sources of truth for whether somebody still has
-- an account, and they would drift the first time a trade was edited, a sync
-- backfilled an old fill, or a rule was corrected. The rules change rarely and
-- by hand; the figures change constantly and by derivation. Only the first
-- kind belongs in a table.

create table if not exists public.funded_accounts (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users (id) on delete cascade,

  label                    text not null default 'Challenge',
  firm                     text,
  -- Free text on purpose: every firm names its stages differently and a
  -- constraint here would reject a real account for cosmetic reasons.
  phase                    text,

  -- Which trades count. null means every trade the user has, which is right
  -- for someone tracking a single account and wrong the moment they add a
  -- second — so the UI pushes toward picking one.
  broker_account_id        uuid references public.broker_accounts (id) on delete set null,

  starting_balance         numeric not null default 100000,

  -- Null means the firm has no such rule. Zero would be a rule that is
  -- breached before the first trade, so the check forbids it and the client
  -- normalises 0 to null before it ever gets here.
  profit_target            numeric check (profit_target is null or profit_target > 0),
  daily_loss_limit         numeric check (daily_loss_limit is null or daily_loss_limit > 0),
  max_loss                 numeric check (max_loss is null or max_loss > 0),

  min_trading_days         integer not null default 0 check (min_trading_days >= 0),

  -- Share of total profit allowed from the single best day, as a fraction.
  consistency_limit        numeric check (consistency_limit is null
                             or (consistency_limit > 0 and consistency_limit <= 1)),

  drawdown_type            text not null default 'static'
                             check (drawdown_type in ('static', 'trailing')),

  -- Minutes to add to UTC to reach the firm's own day boundary. A firm
  -- resetting at 17:00 New York is -300. This is not decoration: the daily
  -- loss limit is evaluated per day, so the boundary decides which day a
  -- late-session loss lands in, and therefore whether it breaches.
  day_reset_offset_minutes integer not null default 0
                             check (day_reset_offset_minutes between -840 and 840),

  -- Trades before this instant are ignored. A challenge usually starts partway
  -- through an account's history, and without this the account would begin
  -- already in drawdown from trades that predate it.
  started_at               timestamptz,

  -- Kept rather than deleted: a failed challenge is the most instructive thing
  -- in the journal, and deleting it is exactly what a trader wants to do the
  -- day it fails.
  archived                 boolean not null default false,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.funded_accounts is
  'Prop-firm challenge rules. Balances and pass/fail are derived from trades, never stored here.';

create index if not exists funded_accounts_user_idx
  on public.funded_accounts (user_id, archived, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security — owner only, like every other table in this schema
-- ---------------------------------------------------------------------------
alter table public.funded_accounts enable row level security;

drop policy if exists "funded - read own"   on public.funded_accounts;
drop policy if exists "funded - insert own" on public.funded_accounts;
drop policy if exists "funded - update own" on public.funded_accounts;
drop policy if exists "funded - delete own" on public.funded_accounts;

create policy "funded - read own" on public.funded_accounts
  for select using (auth.uid() = user_id);
create policy "funded - insert own" on public.funded_accounts
  for insert with check (auth.uid() = user_id);
-- Both clauses spelled out. Postgres would substitute USING for a missing
-- WITH CHECK, but relying on that means the next reader has to know it too.
create policy "funded - update own" on public.funded_accounts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "funded - delete own" on public.funded_accounts
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create or replace function public.funded_accounts_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists funded_accounts_touch on public.funded_accounts;
create trigger funded_accounts_touch
  before update on public.funded_accounts
  for each row execute function public.funded_accounts_touch();
