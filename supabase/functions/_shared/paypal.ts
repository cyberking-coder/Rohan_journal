// Shared PayPal helpers for the checkout + webhook Edge Functions.
//
// PayPal's Subscriptions API takes plan IDs created ahead of time in the
// PayPal dashboard (or via the /v1/billing/plans endpoint). We map plan
// name + billing cycle to those plan IDs via env vars so nothing in code
// changes when you tweak prices — you swap the plan id in Supabase secrets.

export function paypalBase() {
  return (Deno.env.get('PAYPAL_ENV') ?? 'sandbox') === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com'
}

export async function paypalToken(): Promise<string> {
  const id = Deno.env.get('PAYPAL_CLIENT_ID')
  const secret = Deno.env.get('PAYPAL_SECRET')
  if (!id || !secret) throw new Error('PAYPAL_CLIENT_ID and PAYPAL_SECRET must be set')

  const resp = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  const j = await resp.json()
  if (!resp.ok) throw new Error(`paypal auth ${resp.status} ${JSON.stringify(j)}`)
  return j.access_token
}

export async function paypal(path: string, init: RequestInit = {}, token?: string) {
  const tok = token ?? await paypalToken()
  const resp = await fetch(`${paypalBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${tok}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await resp.text()
  const body = text ? JSON.parse(text) : {}
  if (!resp.ok) throw new Error(`paypal ${resp.status} ${JSON.stringify(body)}`)
  return body
}

// ("pro","yearly") → env var PAYPAL_PLAN_PRO_YEARLY.
export function planIdFor(plan: string, billing: string) {
  const key = `PAYPAL_PLAN_${plan.toUpperCase()}_${billing.toUpperCase()}`
  const id = Deno.env.get(key)
  if (!id) throw new Error(`${key} is not set`)
  return id
}

export function planFromPayPalId(planId: string): { plan: string; billing: string } | null {
  for (const plan of ['pro', 'elite']) {
    for (const billing of ['monthly', 'yearly']) {
      if (Deno.env.get(`PAYPAL_PLAN_${plan.toUpperCase()}_${billing.toUpperCase()}`) === planId) {
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
