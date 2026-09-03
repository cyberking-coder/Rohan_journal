// Stripe webhook — the single source of truth for subscription state.
//
// Handles: checkout.session.completed (new sub), customer.subscription.updated
// (plan change, renewal, pause), customer.subscription.deleted (cancelled).
// Every event mutates `public.subscriptions` for the matching user.
//
// Deploy with `--no-verify-jwt` so Stripe can call it unauthenticated; the
// Stripe-Signature header is verified below with STRIPE_WEBHOOK_SECRET.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { planFromPriceId, stripe } from '../_shared/stripe.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature') ?? ''
  const raw = await req.text()

  try {
    await verifySignature(raw, sig, WEBHOOK_SECRET)
  } catch (e) {
    return new Response(`bad signature: ${String(e?.message ?? e)}`, { status: 400 })
  }

  const event = JSON.parse(raw)
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object
        const userId = s.metadata?.user_id
        if (userId && s.subscription) {
          const sub = await stripe(`/subscriptions/${s.subscription}`)
          await writeSub(userId, sub, s.customer)
        }
        break
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created':
      case 'customer.subscription.deleted': {
        const sub = event.data.object
        const userId = sub.metadata?.user_id || await userIdForCustomer(sub.customer)
        if (userId) await writeSub(userId, sub, sub.customer)
        break
      }
    }
  } catch (e) {
    console.error('webhook handler error', e)
    return new Response('handler error', { status: 500 })
  }

  return new Response('ok', { status: 200 })
})

async function userIdForCustomer(customerId: string): Promise<string | null> {
  const { data } = await svc.from('subscriptions')
    .select('user_id').eq('stripe_customer_id', customerId).maybeSingle()
  return data?.user_id ?? null
}

async function writeSub(userId: string, sub: any, customerId: string) {
  const priceId = sub.items?.data?.[0]?.price?.id
  const pb = priceId ? planFromPriceId(priceId) : null
  const active = ['active', 'trialing', 'past_due'].includes(sub.status)
  await svc.from('subscriptions').upsert({
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id ?? null,
    plan: active && pb ? pb.plan : 'free',
    billing: pb?.billing ?? null,
    status: sub.status ?? 'inactive',
    current_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString() : null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
  })
}

// ---------------------------------------------------------------------------
// Stripe signature verification (v1 scheme). Reimplemented so we don't need
// the Stripe SDK (which pulls Node polyfills). Constant-time compare.
// ---------------------------------------------------------------------------

async function verifySignature(payload: string, header: string, secret: string) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')))
  const t = parts.t
  const v1 = parts.v1
  if (!t || !v1) throw new Error('malformed Stripe-Signature header')

  // Reject if the timestamp is more than 5 minutes off — Stripe's default tolerance.
  const skew = Math.abs(Date.now() / 1000 - Number(t))
  if (!Number.isFinite(skew) || skew > 300) throw new Error('timestamp outside tolerance')

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const macBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`))
  const expected = Array.from(new Uint8Array(macBuf)).map((b) => b.toString(16).padStart(2, '0')).join('')

  if (expected.length !== v1.length) throw new Error('signature mismatch')
  let mismatch = 0
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ v1.charCodeAt(i)
  if (mismatch !== 0) throw new Error('signature mismatch')
}
