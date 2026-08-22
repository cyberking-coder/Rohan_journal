import { useCallback, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'
import { DEFAULT_RULES } from './funded'

const TABLE = 'funded_accounts'
const LS_KEY = 'forex_greek_funded'

// Column names are snake_case in the database and camelCase in the rule
// engine. Mapping in one pair of functions keeps the engine ignorant of the
// database, which is what lets it be tested without one.
function fromRow(row) {
  return {
    id: row.id,
    label: row.label,
    firm: row.firm || '',
    phase: row.phase || '',
    brokerAccountId: row.broker_account_id || null,
    startingBalance: Number(row.starting_balance),
    profitTarget: row.profit_target === null ? null : Number(row.profit_target),
    dailyLossLimit: row.daily_loss_limit === null ? null : Number(row.daily_loss_limit),
    maxLoss: row.max_loss === null ? null : Number(row.max_loss),
    minTradingDays: Number(row.min_trading_days) || 0,
    consistencyLimit: row.consistency_limit === null ? null : Number(row.consistency_limit),
    drawdownType: row.drawdown_type,
    dayResetOffsetMinutes: Number(row.day_reset_offset_minutes) || 0,
    startedAt: row.started_at || null,
    archived: !!row.archived,
    createdAt: row.created_at,
  }
}

function toRow(a, userId) {
  return {
    user_id: userId,
    label: a.label?.trim() || 'Challenge',
    firm: a.firm?.trim() || null,
    phase: a.phase?.trim() || null,
    broker_account_id: a.brokerAccountId || null,
    starting_balance: Number(a.startingBalance) || DEFAULT_RULES.startingBalance,
    // The column forbids zero, because a limit of zero would breach before the
    // first trade. The UI's empty field means "this firm has no such rule", so
    // it is translated to null here rather than being rejected at the database.
    profit_target: nullableAmount(a.profitTarget),
    daily_loss_limit: nullableAmount(a.dailyLossLimit),
    max_loss: nullableAmount(a.maxLoss),
    min_trading_days: Math.max(0, Math.floor(Number(a.minTradingDays) || 0)),
    consistency_limit: nullableFraction(a.consistencyLimit),
    drawdown_type: a.drawdownType === 'trailing' ? 'trailing' : 'static',
    day_reset_offset_minutes: Math.trunc(Number(a.dayResetOffsetMinutes) || 0),
    started_at: a.startedAt || null,
    archived: !!a.archived,
  }
}

function nullableAmount(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function nullableFraction(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(n > 1 ? n / 100 : n, 1)
}

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') } catch { return [] }
}
function saveLocal(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)) } catch { /* ignore */ }
}

/**
 * The user's prop-firm challenges.
 *
 * Only rules live here. Balances, drawdown and pass/fail are derived by
 * `evaluate()` from the trades, every render — see supabase/funded.sql for why
 * they are not stored.
 */
export function useFundedAccounts(userId) {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  // False when the migration hasn't been run, which is a setup step rather
  // than an error and reads very differently in the UI.
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    if (!isSupabaseConfigured) {
      setAccounts(loadLocal()); setReady(true); setLoading(false)
      return
    }
    const { data, error: err } = await supabase
      .from(TABLE).select('*').order('created_at', { ascending: false })

    if (err) {
      const missing = /relation .* does not exist|schema cache/i.test(err.message || '')
      setError(missing ? null : err.message)
      setReady(!missing)
      setAccounts([])
    } else {
      setAccounts((data || []).map(fromRow))
      setReady(true)
      setError(null)
    }
    setLoading(false)
  }, [userId])

  useEffect(() => { refresh() }, [refresh])

  const save = useCallback(async (draft) => {
    setError(null)
    if (!isSupabaseConfigured) {
      const record = { ...draft, id: draft.id || `local-${Date.now()}` }
      setAccounts((prev) => {
        const next = prev.some((a) => a.id === record.id)
          ? prev.map((a) => (a.id === record.id ? record : a))
          : [record, ...prev]
        saveLocal(next)
        return next
      })
      return record
    }

    const row = toRow(draft, userId)
    const q = draft.id
      ? supabase.from(TABLE).update(row).eq('id', draft.id).select().single()
      : supabase.from(TABLE).insert(row).select().single()

    const { data, error: err } = await q
    if (err) { setError(err.message); return null }

    const saved = fromRow(data)
    setAccounts((prev) => (draft.id
      ? prev.map((a) => (a.id === saved.id ? saved : a))
      : [saved, ...prev]))
    return saved
  }, [userId])

  const setArchived = useCallback(async (id, archived) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, archived } : a)))
    if (!isSupabaseConfigured) { saveLocal(accounts); return }
    const { error: err } = await supabase.from(TABLE).update({ archived }).eq('id', id)
    if (err) { setError(err.message); refresh() }
  }, [accounts, refresh])

  const remove = useCallback(async (id) => {
    setAccounts((prev) => {
      const next = prev.filter((a) => a.id !== id)
      if (!isSupabaseConfigured) saveLocal(next)
      return next
    })
    if (!isSupabaseConfigured) return
    const { error: err } = await supabase.from(TABLE).delete().eq('id', id)
    if (err) { setError(err.message); refresh() }
  }, [refresh])

  return {
    accounts, loading, ready, error,
    save, setArchived, remove, refresh,
    clearError: () => setError(null),
  }
}
