import { useCallback, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'
import { DEFAULT_SECTIONS, expiryFrom } from './sharing'

const TABLE = 'shared_dashboards'

/**
 * The owner's share links.
 *
 * Note what isn't here: nothing decides what a viewer may see. That lives in
 * `shared_view()` in the database. This hook only creates, lists and revokes
 * the links themselves.
 */
export function useShares(userId) {
  const [shares, setShares] = useState([])
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    if (!isSupabaseConfigured) {
      setShares([]); setReady(false); setLoading(false)
      return
    }
    const { data, error: err } = await supabase
      .from(TABLE).select('*').order('created_at', { ascending: false })

    if (err) {
      const missing = /relation .* does not exist|schema cache/i.test(err.message || '')
      setError(missing ? null : err.message)
      setReady(!missing)
      setShares([])
    } else {
      setShares(data || [])
      setReady(true)
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const create = useCallback(async ({ label, sections, accountScope, hideAmounts, expiry }) => {
    if (!isSupabaseConfigured) {
      setError('Sharing needs a Supabase project — there is nowhere to publish from in demo mode.')
      return null
    }
    setError(null)

    // The code is generated in the database. A client-generated one would be
    // as random as the browser's PRNG and, more to the point, chosen by the
    // caller — who could then pick a code they already knew.
    const { data: code, error: codeErr } = await supabase.rpc('new_share_code')
    if (codeErr) { setError(codeErr.message); return null }

    const { data, error: err } = await supabase.from(TABLE).insert({
      owner_user_id: userId,
      code,
      label: label?.trim() || 'Shared view',
      sections: sections?.length ? sections : DEFAULT_SECTIONS,
      account_scope: accountScope || null,
      hide_amounts: !!hideAmounts,
      expires_at: expiryFrom(expiry),
    }).select().single()

    if (err) { setError(err.message); return null }
    setShares((prev) => [data, ...prev])
    return data
  }, [userId])

  /**
   * Revoke rather than delete.
   *
   * The row is what proves a link existed, when it was used and how often. If
   * a share turns out to have gone somewhere it shouldn't, deleting the
   * evidence is the last thing you want.
   */
  const revoke = useCallback(async (id) => {
    setShares((prev) => prev.map((s) => (s.id === id ? { ...s, revoked: true } : s)))
    if (!isSupabaseConfigured) return
    const { error: err } = await supabase.from(TABLE).update({ revoked: true }).eq('id', id)
    if (err) { setError(err.message); refresh() }
  }, [refresh])

  const remove = useCallback(async (id) => {
    setShares((prev) => prev.filter((s) => s.id !== id))
    if (!isSupabaseConfigured) return
    const { error: err } = await supabase.from(TABLE).delete().eq('id', id)
    if (err) { setError(err.message); refresh() }
  }, [refresh])

  return { shares, loading, ready, error, create, revoke, remove, refresh, clearError: () => setError(null) }
}
