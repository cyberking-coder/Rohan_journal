-- Phase 12 — server-side plan enforcement.
--
-- The client already hides gated features and caps Free users at 15 trades
-- per month, but that's advisory: anyone with the API can call the anon
-- endpoint directly. This turns the same rules into database policies so
-- the limit holds no matter who's calling.
--
-- What's enforced here:
--   * A Free user can only INSERT a new trade if they've logged fewer than
--     15 this calendar month. Editing existing trades is unaffected.
--   * (broker_connections is already service-role only — the plan check
--     for MetaApi lives in the broker-connect Edge Function.)

-- Small helper: the plan for the calling user, defaulting to 'free' when
-- no subscription row exists yet.
create or replace function public.current_user_plan()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select plan from public.subscriptions where user_id = auth.uid()),
    'free'
  );
$$;

revoke all on function public.current_user_plan() from public;
grant execute on function public.current_user_plan() to authenticated;

-- Number of trades this calling user has logged in the current calendar
-- month, as-of now. Used by the insert policy below and reusable elsewhere.
create or replace function public.trades_this_month()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.trades
  where user_id = auth.uid()
    and traded_at >= date_trunc('month', now())
    and traded_at <  date_trunc('month', now()) + interval '1 month';
$$;

revoke all on function public.trades_this_month() from public;
grant execute on function public.trades_this_month() to authenticated;

-- Replace the existing "own trades - insert" policy with one that also
-- enforces the Free-tier monthly cap. Pro / Elite get unlimited.
drop policy if exists "own trades - insert" on public.trades;

create policy "own trades - insert" on public.trades
  for insert
  with check (
    auth.uid() = user_id
    and (
      public.current_user_plan() in ('pro','elite')
      or public.trades_this_month() < 15
    )
  );

-- The other three policies (select / update / delete) are unchanged from
-- schema.sql — this file only touches insert.
