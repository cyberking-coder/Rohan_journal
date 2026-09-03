// Client wrapper for the Stripe checkout, portal and subscription-read flows.
// All heavy lifting is in Edge Functions; the browser only knows plan names.

import { useCallback, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase.js'

export async function startCheckout({ plan, billing }) {
  if (!isSupabaseConfigured) return { error: 'Supabase is not configured' }
  const { data, error } = await supabase.functions.invoke('create-checkout-session', {
    body: { plan, billing },
  })
  if (error) return { error: data?.error || error.message }
  if (data?.error) return { error: data.error }
  if (data?.url) {
    window.location.href = data.url
    return { error: null }
  }
  return { error: 'No checkout URL returned' }
}

export async function openBillingPortal() {
  if (!isSupabaseConfigured) return { error: 'Supabase is not configured' }
  const { data, error } = await supabase.functions.invoke('create-billing-portal', { body: {} })
  if (error) return { error: data?.error || error.message }
  if (data?.error) return { error: data.error }
  if (data?.url) {
    window.location.href = data.url
    return { error: null }
  }
  return { error: 'No portal URL returned' }
}

/**
 * Reads the current user's subscription. Returns a stable object even in
 * demo mode / when no row exists, so callers can rely on `plan` always being
 * defined (defaulting to 'free').
 */
export function useSubscription() {
  const [sub, setSub] = useState({ plan: 'free', status: 'inactive' })
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    setLoading(true)
    if (!isSupabaseConfigured) { setLoading(false); return }
    const { data, error } = await supabase.rpc('my_subscription')
    if (!error && Array.isArray(data) && data[0]) {
      setSub({ ...data[0] })
    } else {
      setSub({ plan: 'free', status: 'inactive' })
    }
    setLoading(false)
  }, [])

  useEffect(() => { refetch() }, [refetch])
  return { sub, loading, refetch }
}
