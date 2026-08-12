-- Phase 5 — broker accounts.
--
-- Gives trades a real account to belong to, instead of inferring one from the
-- `source` string. Safe to re-run.
--
-- Run in the Supabase SQL editor after phase4.sql.
--
-- ── On credentials ─────────────────────────────────────────────────────────
-- There is deliberately NO password / investor-credential column here.
--
-- This app is a browser SPA talking straight to Supabase. Any column the
-- client can read is a column that cross-site scripting, a malicious
-- extension, or anyone with the user's laptop can read too. Storing live
-- broker credentials there would turn a journal into a way to lose an account.
--
-- Credential-based sync needs a server the browser cannot read from: a
-- Supabase Edge Function or a hosted bridge holding the secret, with the
-- credential written once and never returned. That belongs with the
-- broker-bridge vendor decision, not here.
--
-- Until then, sync is done by `mt5_bridge/sync.py`, which runs on the user's
-- own machine, attaches to their already-logged-in MetaTrader terminal, and
-- never transmits a password anywhere.

create table if not exists public.broker_accounts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,

  -- What the user calls it, e.g. "FundingPips Challenge".
  label         text not null,
  -- The firm or platform, e.g. 'FundingPips', 'FortressFX', 'MetaTrader 5'.
  broker        text,
  -- Account number as shown by the broker. Not a secret, but treated as
  -- sensitive in the UI (masked behind the privacy toggle).
  account_number text,
  -- 'mt5' | 'mt4' | 'manual' — how trades reach this account.
  platform      text not null default 'mt5' check (platform in ('mt4', 'mt5', 'manual', 'other')),
  currency      text default 'USD',

  is_favorite   boolean not null default false,
  -- Disconnecting keeps the account and its trades but stops treating it as
  -- live, so history is never destroyed by a disconnect.
  is_active     boolean not null default true,

  -- Written by the sync bridge on every successful run.
  last_synced_at timestamptz,
  last_sync_error text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.broker_accounts is
  'Trading accounts a user tracks. Contains no credentials by design — see the header of phase5.sql.';

create index if not exists broker_accounts_user_idx on public.broker_accounts (user_id);

-- One row per real account, so a re-running bridge updates rather than
-- duplicates. Partial, since account_number is optional for manual accounts.
create unique index if not exists broker_accounts_user_number_uniq
  on public.broker_accounts (user_id, platform, account_number)
  where account_number is not null;

alter table public.broker_accounts enable row level security;

drop policy if exists "own broker accounts - select" on public.broker_accounts;
drop policy if exists "own broker accounts - insert" on public.broker_accounts;
drop policy if exists "own broker accounts - update" on public.broker_accounts;
drop policy if exists "own broker accounts - delete" on public.broker_accounts;

create policy "own broker accounts - select" on public.broker_accounts
  for select using (auth.uid() = user_id);
create policy "own broker accounts - insert" on public.broker_accounts
  for insert with check (auth.uid() = user_id);
create policy "own broker accounts - update" on public.broker_accounts
  for update using (auth.uid() = user_id);
create policy "own broker accounts - delete" on public.broker_accounts
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Link trades to accounts
-- ---------------------------------------------------------------------------
-- `broker_account_id` was added in phase 0 without a foreign key, because the
-- table it points at did not exist yet. Now it does.
--
-- ON DELETE SET NULL, not CASCADE: removing an account must never silently
-- delete the trade history that belongs to it. The trades fall back to being
-- unattributed, which the UI handles.
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'trades_broker_account_fk'
      and table_name = 'trades'
  ) then
    alter table public.trades
      add constraint trades_broker_account_fk
      foreign key (broker_account_id)
      references public.broker_accounts (id)
      on delete set null;
  end if;
end $$;
