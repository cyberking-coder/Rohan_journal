// Shared Stripe helpers for the checkout + portal + webhook Edge Functions.
// Deno's native fetch is used directly against Stripe's REST API rather than
// pulling the SDK — the surface we need is tiny and this keeps cold starts down.

export const STRIPE_API = 'https://api.stripe.com/v1'

export function stripeKey() {
  const k = Deno.env.get('STRIPE_SECRET_KEY')
  if (!k) throw new Error('STRIPE_SECRET_KEY is not set')
  return k
}

export async function stripe(path: string, form?: Record<string, string>, method: 'GET' | 'POST' | 'DELETE' = form ? 'POST' : 'GET') {
  const resp = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${stripeKey()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  })
  const json = await resp.json()
  if (!resp.ok) throw new Error(`stripe ${resp.status} ${json.error?.message ?? JSON.stringify(json)}`)
  return json
}

// Given ("pro","yearly") returns the STRIPE_PRICE_PRO_YEARLY env var.
export function priceIdFor(plan: string, billing: string) {
  const key = `STRIPE_PRICE_${plan.toUpperCase()}_${billing.toUpperCase()}`
  const id = Deno.env.get(key)
  if (!id) throw new Error(`${key} is not set`)
  return id
}

export function planFromPriceId(priceId: string): { plan: string; billing: string } | null {
  for (const plan of ['pro', 'elite']) {
    for (const billing of ['monthly', 'yearly']) {
      if (Deno.env.get(`STRIPE_PRICE_${plan.toUpperCase()}_${billing.toUpperCase()}`) === priceId) {
        return { plan, billing }
      }
    }
  }
  return null
}

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  })
}
