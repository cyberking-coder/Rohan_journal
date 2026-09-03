// Opens a Stripe Customer Portal session so the user can update card,
// cancel, or switch plan. Requires an existing Stripe customer id.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { cors, json, stripe } from '../_shared/stripe.ts'

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

    const { data: sub } = await svc.from('subscriptions')
      .select('stripe_customer_id').eq('user_id', u.user.id).maybeSingle()
    if (!sub?.stripe_customer_id) return json({ error: 'no active subscription' }, 400)

    const portal = await stripe('/billing_portal/sessions', {
      customer: sub.stripe_customer_id,
      return_url: `${APP_URL}?view=settings`,
    })
    return json({ url: portal.url })
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
})
