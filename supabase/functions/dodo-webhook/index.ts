// Dodo Payments webhook — source of truth for subscription state.
//
// Dodo uses the Standard Webhooks signing format: three headers
// (webhook-id, webhook-timestamp, webhook-signature) and an HMAC-SHA256
// signature over "{id}.{timestamp}.{body}" using the base64-decoded
// endpoint secret. verifySignature reimplements it — no SDK needed.
//
// Deploy with `--no-verify-jwt` so Dodo can call it unauthenticated.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { planFromProductId } from '../_shared/dodo.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_SECRET = (Deno.env.get('DODO_WEBHOOK_SECRET') ?? '').trim()

const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

Deno.serve(async (req) => {
  const raw = await req.text()
  const id = req.headers.get('webhook-id') ?? ''
  const ts = req.headers.get('webhook-timestamp') ?? ''
  const sig = req.headers.get('webhook-signature') ?? ''

  try {
    await verifySignature(raw, id, ts, sig)
  } catch (e) {
    return new Response(`signature verify failed: ${String(e?.message ?? e)}`, { status: 400 })
  }

  const event = JSON.parse(raw)
  const type: string = event.type ?? event.event_type ?? ''
  const data = event.data ?? event

  try {
    if (type.startsWith('subscription.') || type.startsWith('payment.')) {
      await handleEvent(type, data)
    }
    return new Response('ok', { status: 200 })
  } catch (e) {
    console.error('webhook handler error', e)
    return new Response('handler error', { status: 500 })
  }
})

async function handleEvent(type: string, data: any) {
  const subId = data.subscription_id ?? data.id
  if (!subId) return

  const userId = data.metadata?.user_id ?? (await userIdFor(subId))
  if (!userId) return

  const productId = data.product_id ?? data.product?.product_id
  const pb = productId ? planFromProductId(productId) : null

  const status = String(data.status ?? '').toLowerCase()
  const active = ['active', 'trialing', 'on_hold'].includes(status)
  const cancelling = ['cancelled', 'canceled', 'expired', 'paused'].includes(status)
    || !!data.cancel_at_next_billing_date

  await svc.from('subscriptions').upsert({
    user_id: userId,
    dodo_subscription_id: subId,
    dodo_customer_id: data.customer?.customer_id ?? data.customer_id ?? null,
    plan: active && pb ? pb.plan : cancelling ? 'free' : 'free',
    billing: pb?.billing ?? null,
    status: status || 'unknown',
    current_period_end: data.next_billing_date ?? data.current_period_end ?? null,
    cancel_at_period_end: cancelling,
  })
}

async function userIdFor(dodoSubId: string): Promise<string | null> {
  const { data } = await svc.from('subscriptions')
    .select('user_id').eq('dodo_subscription_id', dodoSubId).maybeSingle()
  return data?.user_id ?? null
}

// Standard Webhooks signature: sig header is "v1,base64(hmac(secret, id.ts.body))",
// may contain multiple space-separated versions. Timestamp skew 5 min.
async function verifySignature(payload: string, id: string, ts: string, sigHeader: string) {
  if (!WEBHOOK_SECRET) throw new Error('DODO_WEBHOOK_SECRET is not set')
  if (!id || !ts || !sigHeader) throw new Error('missing webhook headers')

  const skew = Math.abs(Date.now() / 1000 - Number(ts))
  if (!Number.isFinite(skew) || skew > 300) throw new Error('timestamp outside tolerance')

  // Secret is prefixed with "whsec_" and base64-encoded after the prefix.
  const secretB64 = WEBHOOK_SECRET.startsWith('whsec_')
    ? WEBHOOK_SECRET.slice('whsec_'.length)
    : WEBHOOK_SECRET
  const secretBytes = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0))

  const key = await crypto.subtle.importKey(
    'raw', secretBytes,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const macBuf = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`${id}.${ts}.${payload}`),
  )
  const expected = btoa(String.fromCharCode(...new Uint8Array(macBuf)))

  const provided = sigHeader.split(' ')
    .map((p) => p.trim())
    .filter((p) => p.startsWith('v1,') || p.startsWith('v1='))
    .map((p) => p.replace(/^v1[,=]/, ''))

  const ok = provided.some((s) => timingSafeEqual(s, expected))
  if (!ok) throw new Error('signature mismatch')
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}
