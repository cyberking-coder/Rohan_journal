// Shared Dodo Payments helpers for the checkout + cancel + webhook Edge
// Functions. Dodo is a merchant-of-record: users pay Dodo, Dodo pays us,
// GST/VAT is handled for us. The API surface we need is small so we call
// their REST directly rather than pulling their SDK.

// Values are trimmed at read time — a stray newline pasted into a Supabase
// secret would otherwise be sent verbatim and quietly rejected.
function envTrim(key: string) {
  return (Deno.env.get(key) ?? '').trim()
}

export function dodoBase() {
  return (envTrim('DODO_ENV') || 'test') === 'live'
    ? 'https://live.dodopayments.com'
    : 'https://test.dodopayments.com'
}

export function dodoKey() {
  const k = envTrim('DODO_API_KEY')
  if (!k) throw new Error('DODO_API_KEY is not set')
  return k
}

export async function dodo(path: string, init: RequestInit = {}) {
  const resp = await fetch(`${dodoBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${dodoKey()}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await resp.text()
  const body = text ? JSON.parse(text) : {}
  if (!resp.ok) throw new Error(`dodo ${resp.status} ${JSON.stringify(body)}`)
  return body
}

// ("pro","yearly") → env var DODO_PRODUCT_PRO_YEARLY.
export function productIdFor(plan: string, billing: string) {
  const key = `DODO_PRODUCT_${plan.toUpperCase()}_${billing.toUpperCase()}`
  const id = envTrim(key)
  if (!id) throw new Error(`${key} is not set`)
  return id
}

export function planFromProductId(productId: string): { plan: string; billing: string } | null {
  const needle = productId.trim()
  for (const plan of ['pro', 'elite']) {
    for (const billing of ['monthly', 'yearly']) {
      if (envTrim(`DODO_PRODUCT_${plan.toUpperCase()}_${billing.toUpperCase()}`) === needle) {
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
