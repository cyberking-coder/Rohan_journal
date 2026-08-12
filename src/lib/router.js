// Query-param router: the whole app lives at `/?view=<key>`.
//
// This matches the URL scheme in the spec and, unlike the previous useState
// navigation, it means every section is linkable, bookmarkable, and the
// browser's back/forward buttons work.

import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_VIEW, isValidView } from './views'

function readView() {
  if (typeof window === 'undefined') return DEFAULT_VIEW
  const key = new URLSearchParams(window.location.search).get('view')
  return key && isValidView(key) ? key : DEFAULT_VIEW
}

function urlForView(key) {
  const params = new URLSearchParams(window.location.search)
  if (key === DEFAULT_VIEW) params.delete('view')
  else params.set('view', key)
  // Sub-view params belong to the view that owns them, so leaving a section
  // must not carry its state into the next one.
  params.delete('tool')
  const qs = params.toString()
  return `${window.location.pathname}${qs ? `?${qs}` : ''}`
}

export function useView() {
  const [view, setView] = useState(readView)

  // Keep in sync when the user hits back/forward.
  useEffect(() => {
    const onPop = () => setView(readView())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((key) => {
    if (!isValidView(key)) return
    setView((current) => {
      if (current === key) return current
      window.history.pushState({ view: key }, '', urlForView(key))
      window.scrollTo({ top: 0 })
      return key
    })
  }, [])

  return [view, navigate]
}

// A secondary query param owned by the current view — used by Tools to open a
// specific tool at `?view=tools&tool=<id>`. Shares the same history stack, so
// the back button steps out of a tool and into the grid.
export function useQueryParam(name) {
  const read = useCallback(() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get(name)
  }, [name])

  const [value, setValue] = useState(read)

  useEffect(() => {
    const onPop = () => setValue(read())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [read])

  const set = useCallback((next) => {
    const params = new URLSearchParams(window.location.search)
    if (next == null) params.delete(name)
    else params.set(name, next)
    const qs = params.toString()
    window.history.pushState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
    window.scrollTo({ top: 0 })
    setValue(next ?? null)
  }, [name])

  return [value, set]
}
