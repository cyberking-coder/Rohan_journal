// Supabase Edge Function — opens the Stripe customer portal.
//
// Cancelling, changing plan, updating a card and downloading invoices all
// happen in Stripe's own portal rather than in screens built here. That is a
// deliberate choice, not laziness: those flows involve PCI scope, dunning
// rules, proration arithmetic and tax, and every one of them is a place where
// a homegrown version is worse and carries liability.
//
// It also means the app never has a "cancel" endpoint of its own, which is one
// fewer thing that can be called by mistake or by someone else's CSRF.
//
// Deploy:
//   supabase functions deploy create-portal
//
// The portal must also be enabled once in the Stripe dashboard
// (Settings → Billing → Customer portal), or this returns a configuration
// error that reads as a bug in the app.

import Stripe from 'npm:stripe@^17.5.0'
import { createClient } from 'npm:@supabase/supabase-js@^2.45.4'

const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? ''
const ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || '*'

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
  if (!STRIPE_KEY || !APP_URL) return json({ error: 'Billing is not configured.' }, 500)

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Not signed in.' }, 401)

  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userErr } = await anon.auth.getUser()
  const user = userData?.user
  if (userErr || !user) return json({ error: 'Not signed in.' }, 401)

  // The customer id comes from the signed-in user's own row, looked up here.
  // Accepting one from the request body would let anyone open a portal session
  // for any customer whose id they could guess or had ever seen — and a portal
  // session shows the card on file and the full invoice history.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: sub } = await admin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!sub?.stripe_customer_id) {
    return json({ error: 'You don’t have a billing account yet — subscribe first.' }, 404)
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${APP_URL}/?view=settings&tab=billing`,
    })
    return json({ url: session.url })
  } catch (err) {
    const message = String(err)
    console.error('create-portal:', message)
    // This particular failure is worth naming, because it is a one-time setup
    // step in the Stripe dashboard and otherwise reads as a bug in the app.
    if (/configuration/i.test(message)) {
      return json({
        error: 'The Stripe customer portal has not been configured yet — enable it in Stripe under Settings → Billing → Customer portal.',
      }, 502)
    }
    return json({ error: 'Could not open the billing portal.' }, 502)
  }
})
