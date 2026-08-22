import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'
import { isShareCode, normaliseCode } from './sharing'

/**
 * Reads a shared dashboard by code.
 *
 * The caller is usually not signed in and owns nothing. Everything comes back
 * from one database function, which is the only thing in the system permitted
 * to read another user's rows — see supabase/phase9.sql.
 */
export function useSharedView(rawCode) {
  const [view, setView] = useState(null)
  const [loading, setLoading] = useState(true)
  // Distinguishes "no such link" from "something went wrong", because those
  // need very different messages.
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState(null)

  const code = normaliseCode(rawCode)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setNotFound(false)
      setError(null)

      if (!code) { setNotFound(true); setLoading(false); return }
      // Checked before the round trip: a malformed code cannot match anything,
      // and not sending it keeps obviously-wrong guesses off the server.
      if (!isShareCode(code)) { setNotFound(true); setLoading(false); return }
      if (!isSupabaseConfigured) {
        setError('This build has no Supabase project configured, so shared links can’t be opened.')
        setLoading(false)
        return
      }

      const { data, error: err } = await supabase.rpc('shared_view', { p_code: code })
      if (cancelled) return

      if (err) {
        const missing = /function .* does not exist|schema cache/i.test(err.message || '')
        setError(missing
          ? 'Sharing isn’t set up on this deployment yet — supabase/phase9.sql hasn’t been run.'
          : err.message)
      } else if (!data) {
        // The function returns null for wrong, revoked and expired alike, on
        // purpose: telling them apart would confirm to someone guessing that a
        // code had once been real.
        setNotFound(true)
      } else {
        setView(data)
      }
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [code])

  return { view, loading, notFound, error, code }
}
