import { useCallback, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'

const TABLE = 'broker_accounts'
const LS_KEY = 'fgj_broker_accounts'

// Demo mode has no database, so accounts live in localStorage exactly as
// trades do — the UI shouldn't behave differently depending on the backend.
function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveLocal(rows) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(rows)) } catch { /* private mode */ }
}

export function useBrokerAccounts(userId = null) {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchAccounts = useCallback(async () => {
    setLoading(true)
    if (!isSupabaseConfigured) {
      setAccounts(loadLocal())
      setError(null)
      setLoading(false)
      return
    }
    const { data, error: err } = await supabase
      .from(TABLE).select('*').order('created_at', { ascending: true })

    if (err) {
      // A missing table means phase5.sql hasn't been applied. The app still
      // works from source-derived accounts, so this is a note, not a failure.
      const missing = /relation .* does not exist|schema cache/i.test(err.message || '')
      setError(missing ? null : err.message)
      setAccounts([])
    } else {
      setAccounts(data || [])
      setError(null)
    }
    setLoading(false)
  }, [userId])

  useEffect(() => { fetchAccounts() }, [fetchAccounts])

  const addAccount = useCallback(async (account) => {
    if (!isSupabaseConfigured) {
      const row = {
        ...account,
        id: `local-${Date.now()}`,
        is_favorite: false,
        is_active: true,
        last_synced_at: null,
        created_at: new Date().toISOString(),
      }
      setAccounts((prev) => { const next = [...prev, row]; saveLocal(next); return next })
      return { data: row, error: null }
    }
    const payload = userId ? { ...account, user_id: userId } : account
    const { data, error: err } = await supabase.from(TABLE).insert(payload).select().single()
    if (!err && data) setAccounts((prev) => [...prev, data])
    return { data, error: err }
  }, [userId])

  const updateAccount = useCallback(async (id, changes) => {
    if (!isSupabaseConfigured) {
      setAccounts((prev) => {
        const next = prev.map((a) => (a.id === id ? { ...a, ...changes } : a))
        saveLocal(next)
        return next
      })
      return { error: null }
    }
    const patch = { ...changes, updated_at: new Date().toISOString() }
    const { data, error: err } = await supabase.from(TABLE).update(patch).eq('id', id).select().single()
    if (!err && data) setAccounts((prev) => prev.map((a) => (a.id === id ? data : a)))
    return { data, error: err }
  }, [])

  // Removing an account leaves its trades in place — the foreign key is
  // ON DELETE SET NULL, so they become unattributed rather than vanishing.
  const removeAccount = useCallback(async (id) => {
    if (!isSupabaseConfigured) {
      setAccounts((prev) => { const next = prev.filter((a) => a.id !== id); saveLocal(next); return next })
      return { error: null }
    }
    const { error: err } = await supabase.from(TABLE).delete().eq('id', id)
    if (!err) setAccounts((prev) => prev.filter((a) => a.id !== id))
    return { error: err }
  }, [])

  return {
    accounts, loading, error,
    addAccount, updateAccount, removeAccount,
    refetch: fetchAccounts,
  }
}
