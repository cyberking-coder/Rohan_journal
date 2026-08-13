import { useCallback, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'

const TABLE = 'economic_events'

/**
 * Reads the shared economic calendar.
 *
 * Nothing writes from the browser — the importer runs with the service role —
 * so this is read-only by design.
 */
export function useEconomicEvents({ days = 14 } = {}) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Distinguishes "the table isn't there yet" from "the table is empty", so
  // the page can say which is true rather than showing one message for both.
  const [ready, setReady] = useState(false)

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    if (!isSupabaseConfigured) {
      setEvents([])
      setReady(false)
      setError(null)
      setLoading(false)
      return
    }

    // A window either side of now: enough for "This Week" without pulling
    // years of history into the browser.
    const from = new Date(Date.now() - 2 * 86400000).toISOString()
    const to = new Date(Date.now() + days * 86400000).toISOString()

    const { data, error: err } = await supabase
      .from(TABLE).select('*')
      .gte('event_at', from).lte('event_at', to)
      .order('event_at', { ascending: true })

    if (err) {
      const missing = /relation .* does not exist|schema cache/i.test(err.message || '')
      setError(missing ? null : err.message)
      setReady(!missing)
      setEvents([])
    } else {
      setEvents(data || [])
      setReady(true)
      setError(null)
    }
    setLoading(false)
  }, [days])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  return { events, loading, error, ready, refetch: fetchEvents }
}
