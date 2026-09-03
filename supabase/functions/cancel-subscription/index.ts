// Cancels the signed-in user's Dodo Payments subscription. The user keeps
// access until the end of the current billing period; the webhook confirms
// with a subscription.cancelled event.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { cors, dodo, json } from '../_shared/dodo.ts'

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

    const { data: sub } = await svc.from('subscriptions')
      .select('dodo_subscription_id, status')
      .eq('user_id', u.user.id).maybeSingle()
    if (!sub?.dodo_subscription_id) return json({ error: 'no active subscription' }, 400)
    if (['cancelled', 'expired'].includes(sub.status ?? '')) {
      return json({ ok: true, already: true })
    }

    // Dodo cancels at period end by default when you PATCH with a cancel flag.
    await dodo(`/subscriptions/${sub.dodo_subscription_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ cancel_at_next_billing_date: true }),
    })

    await svc.from('subscriptions').update({
      cancel_at_period_end: true,
    }).eq('user_id', u.user.id)

    return json({ ok: true })
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
})
