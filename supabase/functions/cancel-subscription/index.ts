// Cancels the signed-in user's PayPal subscription. PayPal doesn't offer a
// Stripe-style hosted portal, so the app runs the cancel itself and points
// the user at their PayPal account for anything else (change card, etc.).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { cors, json, paypal } from '../_shared/paypal.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const auth = req.headers.get('Authorization') ?? ''
    if (!auth.startsWith('Bearer ')) return json({ error: 'missing bearer token' }, 401)

    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { data: u, error: uErr } = await svc.auth.getUser(auth.slice(7))
    if (uErr || !u?.user) return json({ error: 'unauthorised' }, 401)

    const body = await req.json().catch(() => ({}))
    const reason = String(body?.reason ?? 'user requested cancellation').slice(0, 128)

    const { data: sub } = await svc.from('subscriptions')
      .select('paypal_subscription_id, status')
      .eq('user_id', u.user.id).maybeSingle()
    if (!sub?.paypal_subscription_id) return json({ error: 'no active subscription' }, 400)
    if (['cancelled', 'expired'].includes(sub.status ?? '')) {
      return json({ ok: true, already: true })
    }

    await paypal(`/v1/billing/subscriptions/${sub.paypal_subscription_id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })

    // Reflect eagerly; the webhook will confirm.
    await svc.from('subscriptions').update({
      cancel_at_period_end: true,
    }).eq('user_id', u.user.id)

    return json({ ok: true })
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
})
