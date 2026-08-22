import { useCallback, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'
import {
  DELETIONS, USER_TABLES, buildExport, exportFilename, missingSections,
} from './privacy'

/**
 * Export and deletion — PRD §83.
 *
 * Deliberately noisy about partial failure. Everywhere else in this app a
 * missing table is degraded gracefully and quietly; here, silence is the bug.
 * A user who downloads a file believing it holds their trades and finds later
 * that it does not has been failed in a way no error banner would have.
 */
export function usePrivacy(user) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  /**
   * Read every table, then build the document.
   *
   * A table that does not exist yet (its migration hasn't been run) is a
   * warning, not a failure: the user still gets everything that does exist,
   * and the file says what was missing.
   */
  const collect = useCallback(async () => {
    const sections = {}
    const warnings = []

    if (!isSupabaseConfigured) {
      // Demo mode keeps trades in localStorage; exporting nothing at all would
      // be the wrong answer for someone who has been using the app.
      try {
        sections.trades = JSON.parse(localStorage.getItem('forex_greek_trades') || '[]')
      } catch { sections.trades = [] }
      try {
        sections.backtest_sessions = JSON.parse(localStorage.getItem('forex_greek_backtests') || '[]')
      } catch { sections.backtest_sessions = [] }
      try {
        const prefs = localStorage.getItem('forex_greek_prefs')
        sections.profiles = prefs ? JSON.parse(prefs) : null
      } catch { sections.profiles = null }
      warnings.push('This build has no Supabase project configured, so only locally stored data is included.')
      return { sections, warnings }
    }

    for (const t of USER_TABLES) {
      let q = supabase.from(t.table).select('*')
      if (t.order) q = q.order(t.order, { ascending: true })
      // Candles can run to tens of thousands of rows. Capped, and the cap is
      // reported — an export that silently truncated would be exactly the
      // quiet incompleteness this module exists to prevent.
      if (t.bulk) q = q.limit(50000)

      const { data, error: err } = await q
      if (err) {
        const missing = /relation .* does not exist|schema cache/i.test(err.message || '')
        warnings.push(missing
          ? `${t.label}: this table does not exist in your project, so there was nothing to export.`
          : `${t.label}: could not be read (${err.message}). This export is incomplete.`)
        continue
      }
      sections[t.table] = t.single ? (data?.[0] ?? null) : (data || [])
      if (t.bulk && (data || []).length >= 50000) {
        warnings.push(`${t.label}: capped at 50,000 rows. Ask for a full copy if you need it.`)
      }
    }

    for (const name of missingSections(sections)) {
      if (!warnings.some((w) => w.startsWith(labelFor(name)))) {
        warnings.push(`${labelFor(name)}: not included.`)
      }
    }

    return { sections, warnings }
  }, [])

  const exportAll = useCallback(async () => {
    setBusy('export'); setError(null); setResult(null)
    try {
      const { sections, warnings } = await collect()
      const doc = buildExport({ email: user?.email, userId: user?.id, sections, warnings })
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = exportFilename(user?.email)
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoked on the next tick rather than immediately: revoking before the
      // browser has started the download cancels it in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 1000)

      setResult({ kind: 'export', sections, warnings })
      return doc
    } catch (e) {
      setError(e.message || 'Could not build the export.')
      return null
    } finally {
      setBusy(null)
    }
  }, [collect, user])

  /**
   * Run a deletion.
   *
   * Errors are collected rather than thrown on the first one, so a partial
   * failure can be reported honestly: "three of five tables were cleared" is
   * actionable, and stopping at the first error would leave the user unable to
   * tell what state they are in.
   */
  const runDeletion = useCallback(async (action) => {
    const spec = DELETIONS[action]
    if (!spec) return { ok: false, errors: ['Unknown action.'] }

    setBusy(action); setError(null); setResult(null)
    const errors = []
    const cleared = []

    try {
      if (!isSupabaseConfigured) {
        if (spec.tables.includes('trades')) localStorage.removeItem('forex_greek_trades')
        if (spec.tables.includes('backtest_sessions')) localStorage.removeItem('forex_greek_backtests')
        if (spec.terminal) {
          localStorage.removeItem('forex_greek_prefs')
          localStorage.removeItem('forex_greek_funded')
        }
        setResult({ kind: 'delete', action, cleared: spec.tables, errors: [] })
        return { ok: true, errors: [] }
      }

      // Column blanking first (the journal case), because it must not run
      // against rows a later step has already deleted.
      for (const [table, patch] of Object.entries(spec.columns || {})) {
        const { error: err } = await supabase.from(table).update(patch).eq(keyFor(table), user.id)
        if (err) errors.push(`${labelFor(table)}: ${err.message}`)
        else cleared.push(table)
      }

      for (const table of spec.tables) {
        const { error: err } = await supabase.from(table).delete().eq(keyFor(table), user.id)
        if (err) {
          const missing = /relation .* does not exist|schema cache/i.test(err.message || '')
          if (!missing) errors.push(`${labelFor(table)}: ${err.message}`)
        } else {
          cleared.push(table)
        }
      }

      // Screenshots live in storage, not in a table, and a deletion that
      // leaves them behind has not deleted the user's data.
      if (spec.terminal || spec.tables.includes('trades')) {
        const { data: files, error: listErr } = await supabase.storage
          .from('screenshots').list(user.id, { limit: 1000 })
        if (listErr) {
          errors.push(`Screenshots: could not be listed (${listErr.message}).`)
        } else if (files?.length) {
          const { error: rmErr } = await supabase.storage
            .from('screenshots').remove(files.map((f) => `${user.id}/${f.name}`))
          if (rmErr) errors.push(`Screenshots: ${rmErr.message}`)
          else cleared.push('screenshots')
        }
      }

      setResult({ kind: 'delete', action, cleared, errors })
      if (errors.length) setError(`${errors.length} item(s) could not be removed. Your data is only partly deleted.`)
      return { ok: errors.length === 0, errors, cleared }
    } catch (e) {
      setError(e.message || 'Deletion failed.')
      return { ok: false, errors: [e.message] }
    } finally {
      setBusy(null)
    }
  }, [user])

  /**
   * Deleting the sign-in itself needs privileges the browser does not have,
   * and should not have — a client that can delete auth users can delete
   * somebody else's. The rows are removed here and the last step is named
   * plainly rather than faked with a sign-out that looks like success.
   */
  const deleteAccount = useCallback(async () => {
    const res = await runDeletion('account')
    if (res.ok && isSupabaseConfigured) {
      await supabase.auth.signOut()
    }
    return res
  }, [runDeletion])

  return { busy, error, result, exportAll, runDeletion, deleteAccount, clear: () => { setError(null); setResult(null) } }
}

function keyFor(table) {
  return USER_TABLES.find((t) => t.table === table)?.key || 'user_id'
}
function labelFor(table) {
  return USER_TABLES.find((t) => t.table === table)?.label || table
}
