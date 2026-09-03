// Creates a Dodo Payments subscription for the signed-in user and returns
// the hosted checkout URL. The browser redirects there; Dodo calls the
// webhook when the subscription goes active.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { cors, dodo, json, productIdFor } from '../_shared/dodo.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://rohan-journal.vercel.app').trim()

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

    const productId = productIdFor(plan, billing)

    // Dodo needs a billing address. We hand over the minimum it accepts —
    // country falls back to US if the user hasn't told us otherwise. The
    // real address is collected on the hosted checkout page.
    const created = await dodo('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        product_id: productId,
        quantity: 1,
        payment_link: true,
        return_url: `${APP_URL}?checkout=success&view=settings`,
        customer: {
          email: user.email ?? undefined,
          name: user.user_metadata?.full_name || user.email || 'Trader',
        },
        billing: {
          country: 'US',
          state: '',
          city: '',
          street: '',
          zipcode: '',
        },
        metadata: {
          user_id: user.id,
          plan,
          billing,
        },
      }),
    })

    const subscriptionId = created.subscription_id ?? created.id
    const paymentLink = created.payment_link
    if (!paymentLink || !subscriptionId) {
      return json({ error: `dodo returned no payment link: ${JSON.stringify(created).slice(0, 300)}` }, 502)
    }

    await svc.from('subscriptions').upsert({
      user_id: user.id,
      dodo_subscription_id: subscriptionId,
      plan: 'free',
      status: 'pending',
    })

    return json({ url: paymentLink, subscription_id: subscriptionId })
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
})
