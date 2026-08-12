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
