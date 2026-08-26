// Supabase Edge Function — starts a Stripe Checkout session.
//
// The rule this function exists to enforce: the browser says which PLAN it
// wants, never which PRICE it will pay.
//
// A client-supplied price id is the classic hole here. It looks harmless —
// Stripe needs a price, the client knows which button was clicked — but it
// lets anyone create a session against a $0 price they found in the dashboard,
// or against a price from a different product entirely. The plan name is
// translated to a price on this side, from environment variables, and an
// unrecognised plan is refused rather than defaulted.
//
// Deploy:
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//   supabase secrets set STRIPE_PRICE_PRO=price_...
//   supabase secrets set STRIPE_PRICE_PREMIUM=price_...
//   supabase secrets set APP_URL=https://your-app-url
//   supabase functions deploy create-checkout

import Stripe from 'npm:stripe@^17.5.0'
import { createClient } from 'npm:@supabase/supabase-js@^2.45.4'

const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? ''
const ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || '*'

const PRICES: Record<string, string | undefined> = {
  pro: Deno.env.get('STRIPE_PRICE_PRO'),
  premium: Deno.env.get('STRIPE_PRICE_PREMIUM'),
}

const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-12-18.acacia' })

const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  if (!STRIPE_KEY || !APP_URL) {
    return json({ error: 'Billing is not configured on this deployment.' }, 500)
  }

  // ── Who is asking ────────────────────────────────────────────────────────
  // The JWT is verified by asking Supabase, not by decoding it here. A token
  // is only as good as the thing that checks the signature, and that is not
  // this function's job to reimplement.
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Not signed in.' }, 401)

  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userErr } = await anon.auth.getUser()
  const user = userData?.user
  if (userErr || !user) return json({ error: 'Not signed in.' }, 401)

  // ── What they want ───────────────────────────────────────────────────────
  let body: { plan?: string }
  try { body = await req.json() } catch { return json({ error: 'Bad request.' }, 400) }

  const plan = String(body.plan || '').toLowerCase()
  const priceId = PRICES[plan]

  // Refused, not defaulted. A typo becoming a charge for the wrong plan is
  // worse than a failed request.
  if (!priceId) {
    return json({ error: `No price is configured for the ${plan || 'requested'} plan.` }, 400)
  }

  // ── Reuse the customer if we have one ────────────────────────────────────
  // Creating a second Stripe customer for the same person splits their billing
  // history and makes the portal show an empty account. Read with the service
  // role because the row may not exist yet and the user cannot write it.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: existing } = await admin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle()

  let customerId = existing?.stripe_customer_id ?? undefined

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      // So a human looking at the Stripe dashboard can tie a payment back to
      // an account without a database query.
      metadata: { user_id: user.id },
    })
    customerId = customer.id
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],

      // The webhook reads this to know whose subscription it is. It is set
      // here, server-side, from a verified JWT — never from the request body.
      metadata: { user_id: user.id },
      subscription_data: { metadata: { user_id: user.id } },

      success_url: `${APP_URL}/?view=settings&tab=billing&checkout=success`,
      cancel_url: `${APP_URL}/?view=settings&tab=billing&checkout=cancelled`,

      // Lets Stripe collect the tax status it needs where it applies. Without
      // it, selling into the EU or UK is a problem you discover late.
      automatic_tax: { enabled: true },
      billing_address_collection: 'auto',
      allow_promotion_codes: true,
    })

    return json({ url: session.url })
  } catch (err) {
    console.error('create-checkout:', String(err))
    // The Stripe error may name internal price ids; the caller gets a plain
    // message and the detail stays in the logs.
    return json({ error: 'Could not start checkout. Please try again.' }, 502)
  }
})
