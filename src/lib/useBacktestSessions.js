import { useCallback, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'

const TABLE = 'backtest_sessions'
const LS_KEY = 'forex_greek_backtests'

/**
 * Saved replay sessions.
 *
 * The candles are never saved — see the header of supabase/phase8.sql. What is
 * saved is what the trader did: the trades, the period, and enough context to
 * read the result honestly months later.
 */
export function useBacktestSessions(userId) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    if (!isSupabaseConfigured) {
      setSessions(loadLocal()); setReady(true); setLoading(false)
      return
    }
    const { data, error: err } = await supabase
      .from(TABLE).select('*').order('created_at', { ascending: false })

    if (err) {
      const missing = /relation .* does not exist|schema cache/i.test(err.message || '')
      setError(missing ? null : err.message)
      setReady(!missing)
      setSessions([])
    } else {
      setSessions((data || []).map(fromRow))
      setReady(true)
      setError(null)
    }
    setLoading(false)
  }, [userId])

  useEffect(() => { refresh() }, [refresh])

  const save = useCallback(async (draft) => {
    setError(null)
    const record = {
      name: draft.name?.trim() || 'Untitled session',
      symbol: draft.symbol || 'UNKNOWN',
      timeframe: draft.timeframe || null,
      periodStart: draft.periodStart || null,
      periodEnd: draft.periodEnd || null,
      candleCount: draft.candleCount || 0,
      sourceFile: draft.sourceFile || null,
      startingBalance: draft.startingBalance ?? 10000,
      trades: draft.trades || [],
      ambiguousFills: draft.ambiguousFills || 0,
      // What the costs were set to. Without it a saved session is unreadable
      // later: "did this make $400 net or gross?" has no answer, and the
      // comparison against live would be against an unknown baseline.
      costs: draft.costs || null,
      notes: draft.notes || null,
    }

    if (!isSupabaseConfigured) {
      const local = { ...record, id: `local-${Date.now()}`, createdAt: new Date().toISOString() }
      setSessions((prev) => { const next = [local, ...prev]; saveLocal(next); return next })
      return local
    }

    const { data, error: err } = await supabase.from(TABLE).insert({
      user_id: userId,
      name: record.name,
      symbol: record.symbol,
      timeframe: record.timeframe,
      period_start: record.periodStart,
      period_end: record.periodEnd,
      candle_count: record.candleCount,
      source_file: record.sourceFile,
      starting_balance: record.startingBalance,
      trades: record.trades,
      ambiguous_fills: record.ambiguousFills,
      notes: record.notes,
      costs: record.costs,
    }).select().single()

    if (err) { setError(err.message); return null }
    const saved = fromRow(data)
    setSessions((prev) => [saved, ...prev])
    return saved
  }, [userId])

  const remove = useCallback(async (id) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id)
      if (!isSupabaseConfigured) saveLocal(next)
      return next
    })
    if (!isSupabaseConfigured) return
    const { error: err } = await supabase.from(TABLE).delete().eq('id', id)
    if (err) { setError(err.message); refresh() }
  }, [refresh])

  return { sessions, loading, ready, error, save, remove, refresh }
}

function fromRow(row) {
  return {
    id: row.id,
    name: row.name,
    symbol: row.symbol,
    timeframe: row.timeframe,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    candleCount: row.candle_count,
    sourceFile: row.source_file,
    startingBalance: Number(row.starting_balance),
    trades: Array.isArray(row.trades) ? row.trades : [],
    ambiguousFills: row.ambiguous_fills || 0,
    costs: row.costs || null,
    notes: row.notes,
    createdAt: row.created_at,
  }
}

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') } catch { return [] }
}
function saveLocal(list) {
  // Trades can be a lot of rows. If the quota is hit, drop the oldest sessions
  // rather than losing the save entirely — the recent ones are what a
  // comparison is run against.
  let next = list
  for (let attempt = 0; attempt < 5; attempt++) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); return } catch {
      if (next.length <= 1) return
      next = next.slice(0, Math.max(1, Math.floor(next.length / 2)))
    }
  }
}
