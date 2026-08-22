-- Columns + constraints for the MT5 auto-sync bridge.
-- Run once in the Supabase SQL editor.

alter table public.trades add column if not exists external_id  text;    -- MT5 position ticket
alter table public.trades add column if not exists source       text default 'manual'; -- 'manual' | 'mt5'
alter table public.trades add column if not exists swap         numeric default 0;
alter table public.trades add column if not exists stop_loss    numeric;
alter table public.trades add column if not exists take_profit  numeric;

-- Prevent duplicate imports: one row per (user, MT5 ticket).
--
-- Deliberately NOT a partial index. A `where external_id is not null` variant
-- looks tidier and is what this file used to have, but Postgres cannot infer a
-- partial index for ON CONFLICT — so every upsert from the bridge failed with
-- "42P10: there is no unique or exclusion constraint matching the ON CONFLICT
-- specification". The same mistake was in phase6.sql and is fixed there too.
--
-- Dropping the WHERE clause costs nothing: Postgres treats NULLs as distinct,
-- so any number of manually-entered trades (which have no external_id) still
-- coexist happily under this index.
drop index if exists public.trades_user_external_uniq;

create unique index if not exists trades_user_external_uniq
  on public.trades (user_id, external_id);
