// Creates a PayPal subscription for the signed-in user and returns the
// PayPal-hosted approval URL. The browser redirects there; on approval
// PayPal sends the user back to ${APP_URL}?checkout=success and fires
// BILLING.SUBSCRIPTION.ACTIVATED at the webhook.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { cors, json, paypal, planIdFor } from '../_shared/paypal.ts'

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

    const planId = planIdFor(plan, billing)

    const sub = await paypal('/v1/billing/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        plan_id: planId,
        custom_id: user.id,
        subscriber: user.email ? { email_address: user.email } : undefined,
        application_context: {
          brand_name: 'Forex Greek Journal',
          user_action: 'SUBSCRIBE_NOW',
          shipping_preference: 'NO_SHIPPING',
          return_url: `${APP_URL}?checkout=success&view=settings`,
          cancel_url: `${APP_URL}?checkout=cancel&view=pricing`,
        },
      }),
    })

    const approve = sub.links?.find((l: any) => l.rel === 'approve')?.href
    if (!approve) return json({ error: 'no approval link from PayPal' }, 502)

    // Stash the subscription id right away so the webhook can find the user
    // when the ACTIVATED event arrives — subscribers race the webhook.
    await svc.from('subscriptions').upsert({
      user_id: user.id,
      paypal_subscription_id: sub.id,
      plan: 'free',
      status: 'pending',
    })

    return json({ url: approve, subscription_id: sub.id })
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
})
