-- Phase 11 — subscriptions.
--
-- Safe to re-run. Run in the Supabase SQL editor after comparison.sql.
--
-- ── The one thing this file has to get right ───────────────────────────────
-- A user must never be able to write their own plan.
--
-- Every other table here is owner-writable, because the worst case is a user
-- corrupting their own journal. This one is different: a client insert policy
-- on `subscriptions` means anyone who opens the network tab can POST
-- {plan: 'premium'} and take the product for free. There is no clever policy
-- that prevents this while still allowing client writes, because the client is
-- the attacker.
--
-- So there are SELECT policies and nothing else. The only writer is the Stripe
-- webhook function holding the service role key, and the only thing that makes
-- it write is a payload Stripe has signed. That chain — Stripe signs, the
-- function verifies, the service role writes — is the whole security model,
-- and every link is checked.

create table if not exists public.subscriptions (
  user_id            uuid primary key references auth.users (id) on delete cascade,

  -- Mirrors PLAN_ORDER in src/lib/plans.js. Constrained rather than free text:
  -- a typo in a webhook handler that wrote 'premuim' would silently downgrade
  -- a paying customer, and a constraint turns that into a loud failure.
  plan               text not null default 'free'
                       check (plan in ('free', 'pro', 'premium')),

  -- Stripe's own words for the state. Kept verbatim rather than collapsed into
  -- a boolean, because 'past_due' and 'canceled' need different treatment: one
  -- is a customer whose card failed and who should keep access while it
  -- retries, the other is someone who left.
  status             text not null default 'active'
                       check (status in ('active', 'trialing', 'past_due',
                                         'canceled', 'incomplete', 'unpaid', 'paused')),

  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  price_id               text,

  -- When the paid period ends. Access is granted to the end of the period the
  -- customer paid for, not to the moment they click cancel — they bought the
  -- month.
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,

  -- The last Stripe event applied, and when. Stripe delivers out of order and
  -- retries, so an older event must not overwrite a newer one — see the
  -- webhook function.
  last_event_id      text,
  last_event_at      timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.subscriptions is
  'Billing state. Written ONLY by the stripe-webhook function via the service role — there is deliberately no client insert or update policy.';

create index if not exists subscriptions_customer_idx
  on public.subscriptions (stripe_customer_id);

-- ---------------------------------------------------------------------------
-- Row Level Security — read your own, write nothing
-- ---------------------------------------------------------------------------
alter table public.subscriptions enable row level security;

drop policy if exists "subs - read own"   on public.subscriptions;
drop policy if exists "subs - insert own" on public.subscriptions;
drop policy if exists "subs - update own" on public.subscriptions;
drop policy if exists "subs - delete own" on public.subscriptions;

create policy "subs - read own" on public.subscriptions
  for select using (auth.uid() = user_id);

-- No insert, update or delete policy, on purpose. With RLS enabled and no
-- policy for a command, that command is denied for everyone the service role
-- aside. Adding one "just so the app can create a free row" would reopen
-- exactly the hole described at the top of this file — free rows are created
-- by `effective_plan()` returning 'free' for a missing row, not by writing one.

-- ---------------------------------------------------------------------------
-- Reading the plan
-- ---------------------------------------------------------------------------
-- One function so the rule lives in one place. The client has its own copy of
-- the *limits* (src/lib/plans.js) for drawing the UI, but what plan a user is
-- on is decided here, where they cannot reach it.
--
-- The subtlety is `past_due`. A customer whose card just failed is still a
-- customer: Stripe will retry for days, and locking them out on the first
-- failure loses people who would have paid. They keep their plan until the
-- subscription actually ends.
create or replace function public.effective_plan(p_user uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select s.plan
      from public.subscriptions s
      where s.user_id = p_user
        and s.status in ('active', 'trialing', 'past_due')
        -- A cancelled-at-period-end subscription is still paid for until the
        -- period ends. Grace of a day covers clock skew and the gap between
        -- Stripe's clock and ours; being an hour early to downgrade someone
        -- who paid is a worse error than being a day late.
        and (s.current_period_end is null or s.current_period_end > now() - interval '1 day')
    ),
    'free'
  );
$$;

revoke all on function public.effective_plan(uuid) from public;
grant execute on function public.effective_plan(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Idempotency for the webhook
-- ---------------------------------------------------------------------------
-- Stripe guarantees at-least-once delivery, so the same event arrives twice
-- more often than you would think — on retries, and when a deploy times out
-- after the write succeeded. Recording every event id makes replay a no-op.
create table if not exists public.stripe_events (
  id           text primary key,
  type         text not null,
  received_at  timestamptz not null default now()
);

comment on table public.stripe_events is
  'Processed Stripe event ids. Makes webhook delivery idempotent.';

alter table public.stripe_events enable row level security;
-- No policies at all: nothing but the service role has any business reading
-- this, and it holds no user data worth exposing.

-- Housekeeping: Stripe does not retry beyond a few days, so ids older than a
-- month cannot protect against anything and only cost space.
create or replace function public.prune_stripe_events() returns void
language sql security definer set search_path = public as $$
  delete from public.stripe_events where received_at < now() - interval '30 days';
$$;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create or replace function public.subscriptions_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch
  before update on public.subscriptions
  for each row execute function public.subscriptions_touch();
