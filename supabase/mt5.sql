-- Columns + constraints for the MT5 auto-sync bridge.
-- Run once in the Supabase SQL editor.

alter table public.trades add column if not exists external_id  text;    -- MT5 position ticket
alter table public.trades add column if not exists source       text default 'manual'; -- 'manual' | 'mt5'
alter table public.trades add column if not exists swap         numeric default 0;
alter table public.trades add column if not exists stop_loss    numeric;
alter table public.trades add column if not exists take_profit  numeric;

-- Prevent duplicate imports: one row per (user, MT5 ticket).
create unique index if not exists trades_user_external_uniq
  on public.trades (user_id, external_id)
  where external_id is not null;
