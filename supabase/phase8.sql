-- Phase 8 — backtesting sessions.
--
-- Safe to re-run. Run in the Supabase SQL editor after phase7.sql.
--
-- ── What is and isn't stored ───────────────────────────────────────────────
-- Sessions and their simulated trades are stored. The candles are NOT.
--
-- That's deliberate. Price history is bulk data — a year of M5 candles is
-- ~75,000 rows for one symbol — and pushing it through Postgres to redraw a
-- chart is slow and expensive for something the user already has as a file.
-- More importantly, market data licences frequently forbid redistribution,
-- and a shared database of someone else's price history is exactly the thing
-- those terms exist to prevent. The file stays on the user's machine; only
-- what they did with it is saved.

create table if not exists public.backtest_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,

  name          text not null default 'Untitled session',
  symbol        text not null,
  timeframe     text,

  -- Which slice of history was replayed, so an old session can be read
  -- honestly later instead of looking like a claim about today.
  period_start  timestamptz,
  period_end    timestamptz,
  candle_count  integer not null default 0,
  -- Name of the file the candles came from. Just a label — no data is stored.
  source_file   text,

  starting_balance numeric(14,2) not null default 10000,

  -- The simulated trades. jsonb rather than a second table: they're written
  -- once as a set, read as a set, and never queried across sessions. A join
  -- table would buy nothing and cost a migration every time the trade shape
  -- changes.
  trades        jsonb not null default '[]'::jsonb,

  -- Fills the data couldn't settle — where a candle spanned both the stop and
  -- the target. Stored alongside the result so the number can't be quietly
  -- dropped when the session is reloaded.
  ambiguous_fills integer not null default 0,

  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.backtest_sessions is
  'Saved candle-replay sessions. Candles are never stored — only the trades taken.';
comment on column public.backtest_sessions.ambiguous_fills is
  'Fills where one candle contained both stop and target; OHLC cannot say which came first.';

create index if not exists backtest_sessions_user_idx
  on public.backtest_sessions (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Ordinary per-user ownership, unlike ai_reports: there is nothing here that
-- costs money to produce, so the client writing its own rows is fine.
alter table public.backtest_sessions enable row level security;

drop policy if exists "backtest sessions - read own" on public.backtest_sessions;
drop policy if exists "backtest sessions - insert own" on public.backtest_sessions;
drop policy if exists "backtest sessions - update own" on public.backtest_sessions;
drop policy if exists "backtest sessions - delete own" on public.backtest_sessions;

create policy "backtest sessions - read own" on public.backtest_sessions
  for select using (auth.uid() = user_id);

create policy "backtest sessions - insert own" on public.backtest_sessions
  for insert with check (auth.uid() = user_id);

create policy "backtest sessions - update own" on public.backtest_sessions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "backtest sessions - delete own" on public.backtest_sessions
  for delete using (auth.uid() = user_id);
