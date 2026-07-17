-- Run this in the Supabase SQL editor AFTER enabling Google auth in the app.
-- It removes the temporary public policy and locks the table down so each
-- signed-in user can only see and manage their own trades.

alter table public.trades enable row level security;

-- Remove the quick-start public policy if it exists.
drop policy if exists "public access" on public.trades;

-- Recreate the per-user policies (idempotent).
drop policy if exists "own trades - select" on public.trades;
drop policy if exists "own trades - insert" on public.trades;
drop policy if exists "own trades - update" on public.trades;
drop policy if exists "own trades - delete" on public.trades;

create policy "own trades - select" on public.trades
  for select using (auth.uid() = user_id);
create policy "own trades - insert" on public.trades
  for insert with check (auth.uid() = user_id);
create policy "own trades - update" on public.trades
  for update using (auth.uid() = user_id);
create policy "own trades - delete" on public.trades
  for delete using (auth.uid() = user_id);
