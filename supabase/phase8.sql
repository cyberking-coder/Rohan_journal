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

-- ---------------------------------------------------------------------------
-- Candle storage (added after the first phase 8 release)
-- ---------------------------------------------------------------------------
-- Re-run this file to add it; the whole script is idempotent.
--
-- ── Reversing an earlier decision, deliberately ────────────────────────────
-- The header above says candles are not stored, and gives two reasons: bulk
-- data is slow through Postgres, and market-data licences forbid
-- redistribution. The second reason doesn't apply to what this table does.
--
-- Redistribution means serving one party's price data to *other people*. These
-- rows are per-user and RLS-scoped: your own broker's candles, readable only
-- by you, pulled by a bridge running on your own machine. That is the same
-- relationship you already have with your trade history. Nobody else can read
-- them, so nothing is being redistributed.
--
-- The first reason still stands and shapes the design: this is for the
-- timeframes a human actually replays. A year of H1 is ~6,000 rows per symbol
-- and is nothing; a year of M1 is ~375,000 and will be slow and large. The
-- uploader warns before writing anything on that scale.

create table if not exists public.candles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  symbol     text not null,
  -- 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1'
  timeframe  text not null,
  -- Bar open time, always UTC. The bridge converts from the broker's server
  -- clock before writing — see mt5_bridge/export_candles.py.
  t          timestamptz not null,

  o          numeric(18,8) not null,
  h          numeric(18,8) not null,
  l          numeric(18,8) not null,
  c          numeric(18,8) not null,
  v          bigint not null default 0,

  -- No surrogate id: the bar's identity IS (user, symbol, timeframe, time).
  -- A serial key would allow the same bar twice, which is precisely what an
  -- overlapping re-upload would then produce.
  primary key (user_id, symbol, timeframe, t)
);

comment on table public.candles is
  'Per-user OHLC history, uploaded from the user''s own MT5 terminal. Bar times are UTC.';

-- The replay's only query shape: one symbol and timeframe, ordered by time,
-- usually windowed to a date range.
create index if not exists candles_lookup_idx
  on public.candles (user_id, symbol, timeframe, t);

-- Powers the "what do I have?" picker without scanning the bars themselves.
create index if not exists candles_sets_idx
  on public.candles (user_id, symbol, timeframe);

alter table public.candles enable row level security;

drop policy if exists "candles - read own" on public.candles;
drop policy if exists "candles - insert own" on public.candles;
drop policy if exists "candles - update own" on public.candles;
drop policy if exists "candles - delete own" on public.candles;

create policy "candles - read own" on public.candles
  for select using (auth.uid() = user_id);

create policy "candles - insert own" on public.candles
  for insert with check (auth.uid() = user_id);

create policy "candles - update own" on public.candles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "candles - delete own" on public.candles
  for delete using (auth.uid() = user_id);
