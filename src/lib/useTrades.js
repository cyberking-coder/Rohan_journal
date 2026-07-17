import { useCallback, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured, TABLE } from './supabase'
import { generateDemoTrades } from './demo'

const LS_KEY = 'trader_brag_demo_trades'

function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  const seed = generateDemoTrades()
  try { localStorage.setItem(LS_KEY, JSON.stringify(seed)) } catch { /* ignore */ }
  return seed
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
    // Row Level Security scopes rows to the signed-in user; the client
    // query just orders them.
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .order('traded_at', { ascending: true })
    if (error) {
      setError(error.message)
      setTrades(loadLocal())
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
