-- Backtest vs live — Master PRD §67.
--
-- Safe to re-run. Run in the Supabase SQL editor after tags.sql.
--
-- Adds the one column a saved backtest was missing: what it cost to trade.
--
-- Without it a saved session is unreadable a month later. "This made $412"
-- has no meaning if nobody recorded whether that was gross or net, at what
-- spread, with what commission — and a comparison against live trading would
-- be measuring live execution against an unknown baseline, which is worse than
-- not comparing at all.

alter table public.backtest_sessions
  add column if not exists costs jsonb;

comment on column public.backtest_sessions.costs is
  'Execution-cost settings in force when the session was run (see src/lib/execution.js). Null for sessions saved before costs were modelled.';

-- The comparison reads a user's saved sessions and their live trades together,
-- filtered by symbol. Both sides are already indexed per user; this covers the
-- symbol filter on the sessions side.
create index if not exists backtest_sessions_symbol_idx
  on public.backtest_sessions (user_id, symbol, created_at desc);

-- ---------------------------------------------------------------------------
-- A note on what is NOT added here
-- ---------------------------------------------------------------------------
-- No comparison results are stored. They are derived from the session and the
-- trades every time they are shown, for the same reason funded_accounts stores
-- no balances: a stored comparison goes stale the moment a trade is edited or
-- a sync backfills a fill, and a stale answer about whether you are executing
-- your strategy is worse than no answer.
