import { useCallback, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'
import { summariseTrades } from './aiReport'

const TABLE = 'ai_reports'
const FUNCTION = 'generate-report'

/**
 * Reads the report archive and asks the edge function for new ones.
 *
 * Note what this hook does *not* do: it never talks to Anthropic, never holds
 * a key, and never decides whether the user is allowed another report. It
 * posts a trade summary and renders whatever comes back, including the refusal.
 */
export function useAiReports() {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Separates "phase7.sql hasn't been run" from "you have no reports yet".
  const [ready, setReady] = useState(false)
  const [generating, setGenerating] = useState(false)

  const fetchReports = useCallback(async () => {
    setLoading(true)
    if (!isSupabaseConfigured) {
      setReports([])
      setReady(false)
      setError(null)
      setLoading(false)
      return
    }
    const { data, error: err } = await supabase
      .from(TABLE).select('*').order('created_at', { ascending: false }).limit(50)

    if (err) {
      const missing = /relation .* does not exist|schema cache/i.test(err.message || '')
      setError(missing ? null : err.message)
      setReady(!missing)
      setReports([])
    } else {
      setReports(data || [])
      setReady(true)
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchReports() }, [fetchReports])

  const generate = useCallback(async (trades) => {
    if (!isSupabaseConfigured) {
      setError('Reports need a Supabase project — demo mode has nowhere to run the generator.')
      return null
    }
    setGenerating(true)
    setError(null)
    try {
      const { data, error: err } = await supabase.functions.invoke(FUNCTION, {
        body: { summary: summariseTrades(trades) },
      })
      if (err) {
        // invoke() surfaces a non-2xx as a generic FunctionsHttpError; the
        // useful message ("weekly limit reached", "no API key set") is in the
        // response body, so it's worth digging out rather than showing
        // "Edge Function returned a non-2xx status code".
        const detail = await readFunctionError(err)
        setError(detail || err.message)
        return null
      }
      if (data?.error) {
        setError(data.error)
        return null
      }
      if (data?.report) setReports((prev) => [data.report, ...prev])
      return data?.report || null
    } catch (e) {
      setError(e.message)
      return null
    } finally {
      setGenerating(false)
    }
  }, [])

  const remove = useCallback(async (id) => {
    setReports((prev) => prev.filter((r) => r.id !== id))
    if (!isSupabaseConfigured) return
    const { error: err } = await supabase.from(TABLE).delete().eq('id', id)
    if (err) { setError(err.message); fetchReports() }
  }, [fetchReports])

  return { reports, loading, error, ready, generating, generate, remove, refetch: fetchReports, clearError: () => setError(null) }
}

async function readFunctionError(err) {
  try {
    const body = await err.context?.json?.()
    return body?.error || null
  } catch {
    return null
  }
}
