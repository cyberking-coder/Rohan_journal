// Supabase Edge Function — the Stripe webhook.
//
// This is the only thing in the system that may change what a user is paying
// for, so it is worth being explicit about why each guard is here.
//
// ── The threat ─────────────────────────────────────────────────────────────
// This endpoint is public and unauthenticated — it has to be, because Stripe
// calls it, and Stripe does not have a user's JWT. Its URL is not a secret;
// it appears in the Stripe dashboard and in anyone's network tab.
//
// So without signature verification, upgrading yourself to Premium for free is
// a single curl command with a plausible JSON body. Signature verification is
// not a best practice here; it is the entire access control. Everything else
// in this file assumes it has already passed.
//
// ── Deploy ─────────────────────────────────────────────────────────────────
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
//   supabase secrets set STRIPE_PRICE_PRO=price_...
//   supabase secrets set STRIPE_PRICE_PREMIUM=price_...
//   supabase functions deploy stripe-webhook --no-verify-jwt
//
// `--no-verify-jwt` is required and is the one place it is correct: Stripe
// cannot present a Supabase JWT. The signature check below replaces it. Do not
// copy that flag to any other function.

import Stripe from 'npm:stripe@^17.5.0'
import { createClient } from 'npm:@supabase/supabase-js@^2.45.4'

const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Which price buys which plan. Read from the environment rather than hardcoded
// so test and live price ids can differ without a code change — and so a
// price id nobody configured maps to nothing rather than to a free upgrade.
const PRICE_TO_PLAN: Record<string, string> = {}
const proPrice = Deno.env.get('STRIPE_PRICE_PRO')
const premiumPrice = Deno.env.get('STRIPE_PRICE_PREMIUM')
if (proPrice) PRICE_TO_PLAN[proPrice] = 'pro'
if (premiumPrice) PRICE_TO_PLAN[premiumPrice] = 'premium'

const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-12-18.acacia' })

// The service role bypasses RLS. That is exactly what is needed here and
// exactly why this key never leaves this process: `subscriptions` has no
// client write policy, so this client is the only writer in the system.
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// The events that actually change entitlement. Anything else is acknowledged
// with a 200 and ignored — returning an error for events we do not care about
// makes Stripe retry them forever and eventually disable the endpoint.
const HANDLED = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
])

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Fail loudly on misconfiguration rather than silently accepting unsigned
  // traffic. An empty webhook secret would make `constructEventAsync` throw
  // anyway, but an explicit check says why in the logs.
  if (!STRIPE_KEY || !WEBHOOK_SECRET || !SERVICE_KEY) {
    console.error('stripe-webhook: missing required secrets')
    return new Response('Server not configured', { status: 500 })
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) return new Response('Missing signature', { status: 400 })

  // The RAW body. Reading it as JSON first and re-serialising would change the
  // bytes and break the signature — this is the single most common way this
  // check gets accidentally disabled.
  const raw = await req.text()

  let event: Stripe.Event
  try {
    // The async variant is required on Deno: the synchronous one uses Node's
    // crypto and is not available here.
    event = await stripe.webhooks.constructEventAsync(raw, signature, WEBHOOK_SECRET)
  } catch (err) {
    // Deliberately terse. An attacker probing this endpoint learns only that
    // their signature was wrong, and the detail goes to the logs instead.
    console.error('stripe-webhook: signature verification failed', String(err))
    return new Response('Invalid signature', { status: 400 })
  }

  // ── Idempotency ──────────────────────────────────────────────────────────
  // Stripe delivers at least once. The insert is the lock: a duplicate event
  // id collides on the primary key and we return early having done nothing.
  const { error: seenErr } = await admin
    .from('stripe_events')
    .insert({ id: event.id, type: event.type })

  if (seenErr) {
    if (seenErr.code === '23505') {
      return json({ received: true, duplicate: true })
    }
    // A real database failure. Return 500 so Stripe retries rather than
    // dropping an event we never applied.
    console.error('stripe-webhook: could not record event', seenErr.message)
    return new Response('Storage error', { status: 500 })
  }

  if (!HANDLED.has(event.type)) {
    return json({ received: true, ignored: event.type })
  }

  try {
    await apply(event)
  } catch (err) {
    console.error(`stripe-webhook: failed to apply ${event.type}`, String(err))
    // Remove the idempotency record so the retry is actually processed. Left
    // in place, a transient failure would be permanent: Stripe retries, we see
    // a duplicate, and the subscription is never written.
    await admin.from('stripe_events').delete().eq('id', event.id)
    return new Response('Processing error', { status: 500 })
  }

  return json({ received: true })
})

async function apply(event: Stripe.Event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      // The user id was put in metadata when the session was created. It is
      // NOT taken from anything the browser sent with this request — there is
      // no browser here.
      const userId = session.metadata?.user_id
      if (!userId) {
        console.error('stripe-webhook: checkout session without user_id metadata')
        return
      }
      if (!session.subscription) return

      const sub = await stripe.subscriptions.retrieve(session.subscription as string)
      await writeSubscription(userId, sub, event)
      return
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const userId = await userForSubscription(sub)
      if (!userId) {
        console.error('stripe-webhook: no user for subscription', sub.id)
        return
      }
      await writeSubscription(userId, sub, event)
      return
    }

    case 'invoice.payment_failed': {
      // Deliberately does NOT downgrade. Stripe moves the subscription to
      // past_due and retries for days; `effective_plan()` keeps access during
      // that window on purpose. Locking a customer out on the first failed
      // charge loses people whose card simply expired.
      const invoice = event.data.object as Stripe.Invoice
      console.warn('stripe-webhook: payment failed for customer', invoice.customer)
      return
    }
  }
}

/**
 * Which user does this subscription belong to?
 *
 * Metadata first, because it is what we set. The customer id is the fallback
 * for subscriptions created in the Stripe dashboard by hand, which is how
 * comps and support fixes usually happen.
 */
async function userForSubscription(sub: Stripe.Subscription): Promise<string | null> {
  const fromMetadata = sub.metadata?.user_id
  if (fromMetadata) return fromMetadata

  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
  if (!customerId) return null

  const { data } = await admin
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()

  return data?.user_id ?? null
}

async function writeSubscription(userId: string, sub: Stripe.Subscription, event: Stripe.Event) {
  const priceId = sub.items.data[0]?.price?.id ?? null

  // An unrecognised price maps to free, not to the highest plan. If a price is
  // added in Stripe and nobody sets the env var, the failure should be a
  // customer who paid and did not get their upgrade — visible, and fixable in
  // one support message — rather than every customer silently getting
  // Premium.
  const paidPlan = priceId ? (PRICE_TO_PLAN[priceId] ?? 'free') : 'free'
  if (priceId && !PRICE_TO_PLAN[priceId]) {
    console.error(`stripe-webhook: price ${priceId} is not mapped to a plan`)
  }

  // A subscription that has ended grants nothing, whatever it was bought for.
  const dead = sub.status === 'canceled' || sub.status === 'incomplete_expired'
  const plan = dead ? 'free' : paidPlan

  const status = normaliseStatus(sub.status)

  // ── Out-of-order delivery ────────────────────────────────────────────────
  // Stripe does not guarantee ordering, so an "updated" event from a second
  // ago can arrive after a "deleted" from now. Applying it would resurrect a
  // cancelled subscription. The event's own timestamp decides.
  const eventAt = new Date(event.created * 1000).toISOString()

  const { data: existing } = await admin
    .from('subscriptions')
    .select('last_event_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (existing?.last_event_at && new Date(existing.last_event_at) > new Date(eventAt)) {
    console.warn('stripe-webhook: ignoring out-of-order event', event.id)
    return
  }

  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null

  const { error } = await admin.from('subscriptions').upsert({
    user_id: userId,
    plan,
    status,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    price_id: priceId,
    current_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    last_event_id: event.id,
    last_event_at: eventAt,
  }, { onConflict: 'user_id' })

  if (error) throw new Error(error.message)
}

// Stripe has a couple of statuses the table's constraint does not, and a
// constraint violation here would fail the webhook and retry forever. Mapping
// them explicitly is better than widening the constraint to accept anything.
function normaliseStatus(s: Stripe.Subscription.Status): string {
  if (s === 'incomplete_expired') return 'canceled'
  const allowed = ['active', 'trialing', 'past_due', 'canceled', 'incomplete', 'unpaid', 'paused']
  return allowed.includes(s) ? s : 'incomplete'
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
