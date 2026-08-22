import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'

const TABLE = 'candles'

// PostgREST caps a response at 1,000 rows by default, so a year of M5 has to
// be paged. Asked for in large slices to keep the round trips down.
const PAGE = 5000

/**
 * Lists which symbol/timeframe sets the user has uploaded.
 *
 * Deliberately does not count bars: a count would mean scanning every row of
 * every set just to draw a picker.
 */
export function useCandleSets() {
  const [sets, setSets] = useState([])
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    if (!isSupabaseConfigured) {
      setSets([]); setReady(false); setLoading(false)
      return
    }
    // Distinct pairs aren't expressible through PostgREST, so this reads the
    // indexed columns and folds them client-side. The index makes it a scan of
    // keys rather than of bars.
    const { data, error: err } = await supabase
      .from(TABLE).select('symbol,timeframe').limit(50000)

    if (err) {
      const missing = /relation .* does not exist|schema cache/i.test(err.message || '')
      setError(missing ? null : err.message)
      setReady(!missing)
      setSets([])
    } else {
      const seen = new Map()
      for (const row of data || []) {
        const key = `${row.symbol}|${row.timeframe}`
        seen.set(key, (seen.get(key) || 0) + 1)
      }
      setSets([...seen.entries()]
        .map(([key, bars]) => {
          const [symbol, timeframe] = key.split('|')
          return { symbol, timeframe, bars }
        })
        .sort((a, b) => a.symbol.localeCompare(b.symbol) || TF_ORDER.indexOf(a.timeframe) - TF_ORDER.indexOf(b.timeframe)))
      setReady(true)
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const symbols = useMemo(() => [...new Set(sets.map((s) => s.symbol))], [sets])

  return { sets, symbols, loading, ready, error, refresh }
}

export const TF_ORDER = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1']

/** Bars for one symbol and timeframe, oldest first. */
export function useCandles(symbol, timeframe) {
  const [candles, setCandles] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!symbol || !timeframe || !isSupabaseConfigured) {
        setCandles([])
        return
      }
      setLoading(true)
      setError(null)

      const all = []
      let from = 0
      // Paged rather than one huge request: PostgREST would otherwise silently
      // return the first 1,000 bars, and a truncated replay looks like a short
      // history rather than a bug.
      for (;;) {
        const { data, error: err } = await supabase
          .from(TABLE)
          .select('t,o,h,l,c,v')
          .eq('symbol', symbol)
          .eq('timeframe', timeframe)
          .order('t', { ascending: true })
          .range(from, from + PAGE - 1)

        if (err) {
          if (!cancelled) { setError(err.message); setCandles([]); setLoading(false) }
          return
        }
        all.push(...(data || []))
        if (!data || data.length < PAGE) break
        from += PAGE
        // A runaway page loop would hang the tab; this is far above any
        // sensible replay and still finite.
        if (from > 500000) break
      }

      if (cancelled) return
      setCandles(all.map((r) => ({
        t: Date.parse(r.t),
        o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c),
        v: Number(r.v) || 0,
      })))
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [symbol, timeframe])

  return { candles, loading, error }
}
