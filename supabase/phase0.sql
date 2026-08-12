-- Phase 0 — trade schema superset.
--
-- Brings `public.trades` up to the field set the TradeFXBook spec needs
-- (§11.1 of the Analysis module spec) without disturbing existing rows.
-- Safe to re-run.
--
-- Run this in the Supabase SQL editor after schema.sql and mt5.sql.

-- ---------------------------------------------------------------------------
-- Open vs. closed positions
-- ---------------------------------------------------------------------------
-- Until now every row was an already-closed trade. Broker sync (phase 5) also
-- reports live positions, and the Dashboard's "Unrealized" card and the
-- "Open trades" stat both need to count them.
alter table public.trades
  add column if not exists status text not null default 'closed'
  check (status in ('open', 'closed'));

-- The spec buckets trades by session using the OPEN time and by day/period
-- using the CLOSE time, so both timestamps have to exist independently.
-- `traded_at` stays as-is and remains the close time for existing rows.
alter table public.trades add column if not exists opened_at timestamptz;
alter table public.trades add column if not exists closed_at timestamptz;

-- Backfill: treat the existing timestamp as the close, and use it as the open
-- too so hold-time math has a value rather than a null.
update public.trades
   set closed_at = coalesce(closed_at, traded_at),
       opened_at = coalesce(opened_at, traded_at)
 where closed_at is null or opened_at is null;

-- ---------------------------------------------------------------------------
-- Costs
-- ---------------------------------------------------------------------------
-- `fees` already holds commission and is what every existing UI and the MT5
-- bridge write to, so it stays the commission column rather than being
-- duplicated by a second `commission` field that could drift out of sync.
--
-- `swap` and `source` normally arrive with mt5.sql. They are declared here too
-- so this script stands on its own: a migration that fails halfway because an
-- optional earlier script was skipped leaves the database in a worse state
-- than one that simply creates what it needs.
alter table public.trades add column if not exists swap   numeric default 0;
alter table public.trades add column if not exists source text default 'manual';

alter table public.trades alter column swap set default 0;
update public.trades set swap = 0 where swap is null;
alter table public.trades alter column swap set not null;

comment on column public.trades.fees is
  'Commission in account currency. Shown as "Total commissions" in Analysis.';
comment on column public.trades.swap is
  'Swap / rollover financing, separate from pnl and commission.';

-- ---------------------------------------------------------------------------
-- Broker accounts
-- ---------------------------------------------------------------------------
-- Phase 5 introduces the broker_accounts table and multi-account switching.
-- The column lands now so trades written before then can be attributed later;
-- the foreign key is added with the table itself.
alter table public.trades add column if not exists broker_account_id uuid;

create index if not exists trades_broker_account_idx
  on public.trades (broker_account_id);

-- Trades pulled from a broker are read-only — the spec disables deletion for
-- them ("Synced trades cannot be deleted"). This is derived from `source`
-- rather than stored, so it can never contradict where the row came from.
alter table public.trades
  add column if not exists is_deletable boolean
  generated always as (source is null or source = 'manual') stored;

-- ---------------------------------------------------------------------------
-- Indexes for the period filters
-- ---------------------------------------------------------------------------
create index if not exists trades_user_closed_idx
  on public.trades (user_id, closed_at desc);
create index if not exists trades_user_status_idx
  on public.trades (user_id, status);
