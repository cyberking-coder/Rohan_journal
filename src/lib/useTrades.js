import { useCallback, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured, TABLE } from './supabase'

const LS_KEY = 'forex_greek_trades'

// Local storage is only used when Supabase is NOT configured (e.g. local dev).
// It starts empty and only ever holds trades the user actually adds.
function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveLocal(trades) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(trades)) } catch { /* ignore */ }
}

export function useTrades(userId = null) {
  const [trades, setTrades] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchTrades = useCallback(async () => {
    setLoading(true)
    if (!isSupabaseConfigured) {
      setTrades(loadLocal())
      setError(null)
      setLoading(false)
      return
    }
    // Row Level Security scopes rows to the signed-in user.
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .order('traded_at', { ascending: true })
    if (error) {
      // Surface the real problem instead of masking it with fake data.
      setError(error.message)
      setTrades([])
    } else {
      setTrades(data || [])
      setError(null)
    }
    setLoading(false)
  }, [userId])

  useEffect(() => { fetchTrades() }, [fetchTrades])

  const addTrade = useCallback(async (trade) => {
    if (!isSupabaseConfigured) {
      const record = { ...trade, id: `local-${Date.now()}` }
      setTrades((prev) => {
        const next = [...prev, record].sort((a, b) => new Date(a.traded_at) - new Date(b.traded_at))
        saveLocal(next)
        return next
      })
      return { data: record, error: null }
    }
    const payload = userId ? { ...trade, user_id: userId } : trade
    const { data, error } = await supabase.from(TABLE).insert(payload).select().single()
    if (!error && data) {
      setTrades((prev) => [...prev, data].sort((a, b) => new Date(a.traded_at) - new Date(b.traded_at)))
    }
    return { data, error }
  }, [userId])

  const deleteTrade = useCallback(async (id) => {
    if (!isSupabaseConfigured) {
      setTrades((prev) => {
        const next = prev.filter((t) => t.id !== id)
        saveLocal(next)
        return next
      })
      return
    }
    await supabase.from(TABLE).delete().eq('id', id)
    setTrades((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return { trades, loading, error, addTrade, deleteTrade, refetch: fetchTrades, isSupabaseConfigured }
}
