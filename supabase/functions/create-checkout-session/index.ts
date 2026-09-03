// Creates a Stripe Checkout session for the signed-in user and returns its
// URL. The browser redirects to it. On success Stripe sends the user back
// to `${APP_URL}?checkout=success`; the webhook writes the subscription row.
//
// If the user already has a Stripe customer id we reuse it so their card,
// tax id and address carry over between purchases.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { cors, json, priceIdFor, stripe } from '../_shared/stripe.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_URL = Deno.env.get('APP_URL') ?? 'https://rohan-journal.vercel.app'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const auth = req.headers.get('Authorization') ?? ''
    if (!auth.startsWith('Bearer ')) return json({ error: 'missing bearer token' }, 401)

    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { data: u, error: uErr } = await svc.auth.getUser(auth.slice(7))
    if (uErr || !u?.user) return json({ error: 'unauthorised' }, 401)
    const user = u.user

    const body = await req.json().catch(() => null)
    const plan = String(body?.plan ?? '').toLowerCase()
    const billing = String(body?.billing ?? '').toLowerCase()
    if (!['pro', 'elite'].includes(plan)) return json({ error: 'invalid plan' }, 400)
    if (!['monthly', 'yearly'].includes(billing)) return json({ error: 'invalid billing' }, 400)

    const priceId = priceIdFor(plan, billing)

    // Reuse existing Stripe customer if we already know it for this user.
    const { data: sub } = await svc.from('subscriptions')
      .select('stripe_customer_id').eq('user_id', user.id).maybeSingle()
    let customerId = sub?.stripe_customer_id ?? null
    if (!customerId) {
      const cust = await stripe('/customers', {
        email: user.email ?? '',
        'metadata[user_id]': user.id,
      })
      customerId = cust.id
      await svc.from('subscriptions').upsert({
        user_id: user.id, stripe_customer_id: customerId, plan: 'free', status: 'inactive',
      })
    }

    const session = await stripe('/checkout/sessions', {
      mode: 'subscription',
      customer: customerId!,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      success_url: `${APP_URL}?checkout=success&view=settings`,
      cancel_url: `${APP_URL}?checkout=cancel&view=pricing`,
      allow_promotion_codes: 'true',
      'metadata[user_id]': user.id,
      'metadata[plan]': plan,
      'metadata[billing]': billing,
      'subscription_data[metadata][user_id]': user.id,
    })

    return json({ url: session.url })
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
})
