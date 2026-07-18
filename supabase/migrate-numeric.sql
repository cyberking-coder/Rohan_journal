-- Fix column types so fractional lots (0.01, 0.12, ...) can be stored.
-- Run this once in the Supabase SQL editor if you created the table before
-- this change (error: invalid input syntax for type integer: "0.1").

alter table public.trades alter column qty type numeric using qty::numeric;
alter table public.trades alter column rr  type numeric using rr::numeric;

-- screenshot column (safe to re-run)
alter table public.trades add column if not exists screenshot_url text;
