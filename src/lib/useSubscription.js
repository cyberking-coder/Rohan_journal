import { useCallback, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'
import { DEFAULT_PLAN, PLANS } from './plans'
import { resolvePlan } from './billing'

/**
 * The signed-in user's plan.
 *
 * ── What this hook is and is not ───────────────────────────────────────────
 * It is how the UI knows which buttons to draw. It is NOT the enforcement
 * point, and nothing security-relevant may depend on it.
 *
 * Everything here runs in the browser, where the user can set any variable
 * they like. Real enforcement is in the database: `subscriptions` has no
 * client write policy, so the plan cannot be forged, and each limited resource
 * is bounded by its own table policy or by the edge function that writes it.
 * If this hook returned 'premium' for everyone, the worst outcome would be
 * some enabled buttons whose actions then fail server-side.
 *
 * Being clear about that matters, because the tempting next step — "let's just
 * cache the plan in localStorage so the UI doesn't flicker" — is harmless
 * precisely because of it, and would be a catastrophe if it were not.
 */
export function useSubscription(userId) {
  const [plan, setPlan] = useState(DEFAULT_PLAN)
  const [subscription, setSubscription] = useState(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    if (!isSupabaseConfigured || !userId) {
      // No project, or nobody signed in: free, and honest about why. Demo mode
      // deliberately does not grant everything — a demo that behaves unlike
      // the product teaches the wrong thing.
      setPlan(DEFAULT_PLAN); setSubscription(null); setReady(false); setLoading(false)
      return
    }

    const { data, error: err } = await supabase
      .from('subscriptions').select('*').eq('user_id', userId).maybeSingle()

    if (err) {
      const missing = /relation .* does not exist|schema cache/i.test(err.message || '')
      setError(missing ? null : err.message)
      setReady(!missing)
      setPlan(DEFAULT_PLAN)
      setSubscription(null)
    } else {
      setSubscription(data || null)
      // The same rule as `effective_plan()` in supabase/billing.sql. Two
      // implementations of one rule will eventually disagree, so this one is
      // written to be obviously the same shape, and the database's is the one
      // that decides anything that matters.
      setPlan(resolvePlan(data))
      setReady(true)
      setError(null)
    }
    setLoading(false)
  }, [userId])

  useEffect(() => { refresh() }, [refresh])

  /**
   * Send the user to Stripe.
   *
   * The plan name goes up; a price never does. See the note at the top of
   * create-checkout — a client-chosen price is a client-chosen amount.
   */
  const checkout = useCallback(async (planId) => {
    setError(null)
    if (!isSupabaseConfigured) {
      setError('Billing needs a Supabase project — there is nothing to subscribe to in demo mode.')
      return null
    }
    const { data, error: err } = await supabase.functions.invoke('create-checkout', {
      body: { plan: planId },
    })
    if (err || !data?.url) {
      setError(data?.error || err?.message || 'Could not start checkout.')
      return null
    }
    window.location.href = data.url
    return data.url
  }, [])

  const openPortal = useCallback(async () => {
    setError(null)
    const { data, error: err } = await supabase.functions.invoke('create-portal', {})
    if (err || !data?.url) {
      setError(data?.error || err?.message || 'Could not open the billing portal.')
      return null
    }
    window.location.href = data.url
    return data.url
  }, [])

  return {
    plan,
    planDetails: PLANS[plan] || PLANS[DEFAULT_PLAN],
    subscription,
    loading,
    ready,
    error,
    refresh,
    checkout,
    openPortal,
    clearError: () => setError(null),
  }
}
