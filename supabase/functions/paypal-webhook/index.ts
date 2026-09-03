// PayPal webhook — source of truth for subscription state.
//
// Handles: BILLING.SUBSCRIPTION.ACTIVATED, .UPDATED, .CANCELLED, .EXPIRED,
// .SUSPENDED, .PAYMENT.FAILED. Every event calls PayPal to read the current
// subscription and upserts the row.
//
// PayPal signs webhooks with a private key we can't verify locally — the
// documented path is to POST the payload and headers back to PayPal's
// /v1/notifications/verify-webhook-signature and trust their SUCCESS reply.
// That's what verifySignature does. PAYPAL_WEBHOOK_ID must match the id of
// the webhook subscription in your PayPal dashboard.
//
// Deploy with `--no-verify-jwt` so PayPal can call it unauthenticated.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { paypal, paypalToken, planFromPayPalId } from '../_shared/paypal.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_ID = Deno.env.get('PAYPAL_WEBHOOK_ID')!

const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

Deno.serve(async (req) => {
  const raw = await req.text()
  const headers = Object.fromEntries(req.headers)

  try {
    await verifySignature(raw, headers)
  } catch (e) {
    return new Response(`signature verify failed: ${String(e?.message ?? e)}`, { status: 400 })
  }

  const event = JSON.parse(raw)
  const type: string = event.event_type ?? ''

  try {
    if (type.startsWith('BILLING.SUBSCRIPTION.')) {
      const subId = event.resource?.id
      if (!subId) return new Response('no subscription id', { status: 200 })

      // Fetch current state so we don't rely on the possibly-partial event body.
      const sub = await paypal(`/v1/billing/subscriptions/${subId}`)
      const userId = sub.custom_id ?? (await userIdFor(subId))
      if (!userId) return new Response('no user id', { status: 200 })
      await writeSub(userId, sub)
    }
  } catch (e) {
    console.error('webhook handler error', e)
    return new Response('handler error', { status: 500 })
  }

  return new Response('ok', { status: 200 })
})

async function userIdFor(paypalSubId: string): Promise<string | null> {
  const { data } = await svc.from('subscriptions')
    .select('user_id').eq('paypal_subscription_id', paypalSubId).maybeSingle()
  return data?.user_id ?? null
}

async function writeSub(userId: string, sub: any) {
  const planId = sub.plan_id
  const pb = planId ? planFromPayPalId(planId) : null
  const status = String(sub.status ?? '').toLowerCase()
  const active = status === 'active' || status === 'approved'
  const cancelling = status === 'cancelled' || status === 'suspended' || status === 'expired'

  await svc.from('subscriptions').upsert({
    user_id: userId,
    paypal_subscription_id: sub.id,
    paypal_payer_id: sub.subscriber?.payer_id ?? null,
    plan: active && pb ? pb.plan : 'free',
    billing: pb?.billing ?? null,
    status,
    current_period_end: sub.billing_info?.next_billing_time ?? null,
    cancel_at_period_end: cancelling,
  })
}

async function verifySignature(rawBody: string, headers: Record<string, string>) {
  const payload = {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: WEBHOOK_ID,
    webhook_event: JSON.parse(rawBody),
  }
  const token = await paypalToken()
  const r = await paypal('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, token)
  if (r.verification_status !== 'SUCCESS') throw new Error(`verification_status=${r.verification_status}`)
}
