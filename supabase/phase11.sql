-- Phase 11 — Dodo Payments subscriptions.
--
-- One row per user carrying their active plan, Dodo customer/subscription
-- ids, and the subscription's lifecycle state. Written only by the Dodo
-- webhook and the cancel/create Edge Functions (all service role). The
-- browser reads its own row through my_subscription() so provider ids
-- never surface to the anon key.
--
-- Safe to re-run: it drops earlier PayPal columns if they exist and adds
-- the Dodo columns idempotently.

create extension if not exists "pgcrypto";

create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  plan                   text not null default 'free'
                         check (plan in ('free','pro','elite')),
  billing                text check (billing in ('monthly','yearly')),
  status                 text not null default 'inactive',
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  updated_at             timestamptz not null default now()
);

alter table public.subscriptions add column if not exists dodo_subscription_id text;
alter table public.subscriptions add column if not exists dodo_customer_id     text;

-- Drop legacy PayPal / Stripe columns if the earlier phase11 was applied.
alter table public.subscriptions drop column if exists paypal_subscription_id;
alter table public.subscriptions drop column if exists paypal_payer_id;
alter table public.subscriptions drop column if exists stripe_customer_id;
alter table public.subscriptions drop column if exists stripe_subscription_id;

create index if not exists subscriptions_dodo_sub_idx
  on public.subscriptions (dodo_subscription_id);

alter table public.subscriptions enable row level security;
-- No user policies: service role only. Reads go through the RPC below.

create or replace function public.my_subscription()
returns table (
  plan text,
  billing text,
  status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select plan, billing, status, current_period_end, cancel_at_period_end, updated_at
  from public.subscriptions
  where user_id = auth.uid();
$$;

revoke all on function public.my_subscription() from public;
grant execute on function public.my_subscription() to authenticated;

create or replace function public.subscriptions_touch()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch
  before update on public.subscriptions
  for each row execute function public.subscriptions_touch();
