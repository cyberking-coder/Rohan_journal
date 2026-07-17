-- TRADER BRAG — Supabase schema
-- Run this in the Supabase SQL editor to create the trades table.

create extension if not exists "pgcrypto";

create table if not exists public.trades (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users (id) on delete cascade,
  symbol      text not null,
  side        text not null default 'Long' check (side in ('Long', 'Short')),
  strategy    text,
  session     text,
  entry       numeric,
  exit        numeric,
  qty         integer default 1,
  pnl         numeric not null default 0,   -- gross P&L in account currency
  fees        numeric not null default 0,
  rr          numeric,                       -- realised risk : reward
  rating      smallint check (rating between 1 and 5),
  notes       text,
  traded_at   timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists trades_traded_at_idx on public.trades (traded_at desc);
create index if not exists trades_user_idx on public.trades (user_id);

-- Row Level Security: each user only sees their own trades.
alter table public.trades enable row level security;

-- If you are not using auth yet and want the anon key to read/write freely,
-- comment out the policies below and use the permissive one at the bottom.
create policy "own trades - select" on public.trades
  for select using (auth.uid() = user_id);
create policy "own trades - insert" on public.trades
  for insert with check (auth.uid() = user_id);
create policy "own trades - update" on public.trades
  for update using (auth.uid() = user_id);
create policy "own trades - delete" on public.trades
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- QUICK-START (no auth) — uncomment to let the anon key manage all rows.
-- Do NOT use this in production.
-- ---------------------------------------------------------------------------
-- drop policy if exists "own trades - select" on public.trades;
-- drop policy if exists "own trades - insert" on public.trades;
-- drop policy if exists "own trades - update" on public.trades;
-- drop policy if exists "own trades - delete" on public.trades;
-- create policy "public access" on public.trades for all using (true) with check (true);
