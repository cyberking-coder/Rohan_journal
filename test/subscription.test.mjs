// Subscription state.
//
// The arithmetic here is small; the judgement calls are not. Two of them cost
// real money if they are wrong in either direction:
//
//   past_due     — downgrade too early and you lose a customer whose card
//                  simply expired. Never downgrade and you give the product
//                  away to anyone who cancels their card.
//   cancel_at_   — the customer has cancelled but paid through the month.
//   period_end     Cutting them off on the click is theft; calling the plan
//                  "cancelled" while they still have it is a support ticket.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describeStatus, resolvePlan } from '../src/lib/billing.js'
import { DEFAULT_PLAN, PLANS } from '../src/lib/plans.js'

let checks = 0
function ok(c, m) { assert.ok(c, m); checks++ }
function eq(a, b, m) { assert.deepEqual(a, b, m); checks++ }

const DAY = 86400000
const future = (days = 30) => new Date(Date.now() + days * DAY).toISOString()
const past = (days = 30) => new Date(Date.now() - days * DAY).toISOString()

const row = (over = {}) => ({
  plan: 'pro', status: 'active', current_period_end: future(),
  cancel_at_period_end: false, ...over,
})

// ── resolving the plan ─────────────────────────────────────────────────────
{
  eq(resolvePlan(null), DEFAULT_PLAN, 'no subscription is the free plan')
  eq(resolvePlan(undefined), DEFAULT_PLAN, 'and so is undefined')
  eq(resolvePlan(row()), 'pro', 'an active subscription grants its plan')
  eq(resolvePlan(row({ plan: 'premium' })), 'premium', 'including the top one')
  eq(resolvePlan(row({ status: 'trialing' })), 'pro', 'a trial grants the plan')

  // The one that loses customers if it is wrong. Stripe retries a failed
  // charge for days; locking them out on the first failure is premature.
  eq(resolvePlan(row({ status: 'past_due' })), 'pro',
    'a failed payment does not immediately revoke access')

  eq(resolvePlan(row({ status: 'canceled' })), DEFAULT_PLAN, 'a cancelled one grants nothing')
  eq(resolvePlan(row({ status: 'unpaid' })), DEFAULT_PLAN, 'nor an unpaid one')
  eq(resolvePlan(row({ status: 'incomplete' })), DEFAULT_PLAN, 'nor one that never completed')
  eq(resolvePlan(row({ status: 'paused' })), DEFAULT_PLAN, 'nor a paused one')

  // Cancelled but paid through the period: they keep it. They bought the month.
  eq(resolvePlan(row({ cancel_at_period_end: true })), 'pro',
    'cancelling keeps the plan until the period ends')
  eq(resolvePlan(row({ cancel_at_period_end: true, current_period_end: past(5) })), DEFAULT_PLAN,
    'and drops it once the period has passed')

  // Expiry, with the day of grace that matches the SQL.
  eq(resolvePlan(row({ current_period_end: past(5) })), DEFAULT_PLAN, 'a long-expired period grants nothing')
  eq(resolvePlan(row({ current_period_end: new Date(Date.now() - 3600_000).toISOString() })), 'pro',
    'an hour past renewal is still granted — clocks and webhooks lag')
  eq(resolvePlan(row({ current_period_end: null })), 'pro', 'no end date is not an expired one')

  // A plan name that is not a plan must not be trusted through.
  eq(resolvePlan(row({ plan: 'enterprise' })), DEFAULT_PLAN, 'an unknown plan name falls back to free')
  eq(resolvePlan(row({ plan: null })), DEFAULT_PLAN, 'so does a missing one')
  eq(resolvePlan(row({ current_period_end: 'not a date' })), 'pro',
    'an unparseable date does not silently revoke a paying customer')

  // Every plan in the table must actually resolve, or a price could be sold
  // that grants nothing.
  for (const id of Object.keys(PLANS)) {
    eq(resolvePlan(row({ plan: id })), id, `${id} resolves to itself`)
  }
}

// ── describing it ──────────────────────────────────────────────────────────
{
  eq(describeStatus(null).tone, 'neutral', 'no subscription reads as neutral')
  ok(/free plan/.test(describeStatus(null).text), 'and says so')

  const active = describeStatus(row())
  eq(active.tone, 'good', 'active is good news')
  ok(/renews/.test(active.text), 'and names the renewal date')

  // The wording that matters: cancelled-but-still-paid must not read as
  // "cancelled, you have nothing".
  const cancelling = describeStatus(row({ cancel_at_period_end: true }))
  eq(cancelling.tone, 'warn', 'cancelling is a warning, not an error')
  ok(/keep this plan until/.test(cancelling.text), 'and says the plan is kept until the date')
  ok(!/^Cancelled\.$/.test(cancelling.text), 'never a bare "cancelled"')

  const late = describeStatus(row({ status: 'past_due' }))
  eq(late.tone, 'warn', 'a failed payment warns')
  ok(/keep full access/.test(late.text), 'reassures that access continues')
  ok(/update your card/i.test(late.text), 'and says what to do about it')

  eq(describeStatus(row({ status: 'canceled' })).tone, 'neutral', 'a finished subscription is neutral')
  eq(describeStatus(row({ status: 'unpaid' })).tone, 'bad', 'unpaid is bad')
  ok(/Nothing has been charged/.test(describeStatus(row({ status: 'incomplete' })).text),
    'an incomplete payment reassures that no money moved')

  eq(describeStatus(row({ status: 'trialing' })).tone, 'good', 'a trial is good')

  // Every status the table permits must produce something readable, or a real
  // customer sees a raw enum.
  for (const status of ['active', 'trialing', 'past_due', 'canceled', 'incomplete', 'unpaid', 'paused']) {
    const d = describeStatus(row({ status }))
    ok(d.text && d.text.length > 3, `${status} has readable text`)
    ok(['good', 'warn', 'bad', 'neutral'].includes(d.tone), `${status} has a known tone`)
  }
}

// ── the client and the database must agree ─────────────────────────────────
//
// Two implementations of one rule drift. These read the SQL and check the
// statements that matter are actually there, so a change to one side without
// the other is caught here rather than by a customer.
{
  const sql = readFileSync(new URL('../supabase/billing.sql', import.meta.url), 'utf8')

  // The rule that must match resolvePlan's LIVE set.
  ok(/status in \('active', 'trialing', 'past_due'\)/.test(sql),
    'the database grants the plan for exactly the statuses the client does')
  ok(/interval '1 day'/.test(sql), 'and allows the same day of grace')

  // The security property this whole phase rests on.
  ok(/for select using \(auth\.uid\(\) = user_id\)/.test(sql),
    'users may read their own subscription')
  ok(!/create policy[^;]*subscriptions[^;]*for insert/is.test(sql),
    'and there is NO client insert policy — a user must not be able to set their own plan')
  ok(!/create policy[^;]*subscriptions[^;]*for update/is.test(sql),
    'nor an update policy')

  ok(/create table if not exists public\.stripe_events/.test(sql),
    'processed event ids are recorded, making webhook delivery idempotent')
}

// ── the webhook's guarantees, read from its source ─────────────────────────
//
// These cannot be executed here — the function runs on Deno with Stripe's SDK
// — but the properties are important enough that their absence should fail a
// test rather than be noticed in production.
{
  const fn = readFileSync(
    new URL('../supabase/functions/stripe-webhook/index.ts', import.meta.url), 'utf8')

  // Without this the endpoint is an unauthenticated "make me premium" API.
  ok(/constructEventAsync\(/.test(fn), 'the webhook verifies Stripe’s signature')
  ok(/await req\.text\(\)/.test(fn),
    'against the raw body — parsing and re-serialising would break the signature')
  ok(!/req\.json\(\)[\s\S]{0,200}constructEvent/.test(fn),
    'and does not read the body as JSON first')

  ok(/stripe_events/.test(fn), 'duplicate deliveries are dropped')
  ok(/out-of-order|last_event_at/.test(fn), 'out-of-order events are handled')
  ok(/SUPABASE_SERVICE_ROLE_KEY/.test(fn), 'writes go through the service role')

  // An unmapped price must not become a free upgrade.
  ok(/PRICE_TO_PLAN\[priceId\] \?\? 'free'/.test(fn),
    'an unrecognised price maps to free, never to a paid plan')

  const checkout = readFileSync(
    new URL('../supabase/functions/create-checkout/index.ts', import.meta.url), 'utf8')

  // The client must never choose the amount it pays.
  ok(/PRICES\[plan\]/.test(checkout), 'the price is looked up from the plan name server-side')
  ok(!/body\.price|body\.priceId|body\.price_id/.test(checkout),
    'and is never taken from the request body')
  ok(/metadata: \{ user_id: user\.id \}/.test(checkout),
    'the user id in metadata comes from the verified token')
  ok(/auth\.getUser\(\)/.test(checkout), 'the caller is authenticated')

  const portal = readFileSync(
    new URL('../supabase/functions/create-portal/index.ts', import.meta.url), 'utf8')
  ok(/eq\('user_id', user\.id\)/.test(portal),
    'the portal looks up the customer from the signed-in user, not from the request')
  ok(!/body\.customer|body\.customerId/.test(portal),
    'a caller cannot name someone else’s Stripe customer')
}

console.log(`subscription: ${checks} assertions passed`)
