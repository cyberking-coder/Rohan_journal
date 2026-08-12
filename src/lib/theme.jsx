// Theme + display preferences that the top bar toggles and the rest of the
// app reads. Dark is the default, matching the spec.
//
// Streamer Mode is here rather than in Settings because it has to be readable
// from anywhere that renders a money value; Phase 4 adds the Settings UI that
// writes to it, but the plumbing belongs with the other display prefs.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const STORE_KEY = 'fgj_prefs'

const DEFAULTS = {
  theme: 'dark',
  streamerMode: false,
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

const ThemeContext = createContext({
  ...DEFAULTS,
  toggleTheme: () => {},
  setStreamerMode: () => {},
})

export function ThemeProvider({ children }) {
  const [prefs, setPrefs] = useState(load)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', prefs.theme)
    try { localStorage.setItem(STORE_KEY, JSON.stringify(prefs)) } catch { /* private mode */ }
  }, [prefs])

  const toggleTheme = useCallback(() => {
    setPrefs((p) => ({ ...p, theme: p.theme === 'dark' ? 'light' : 'dark' }))
  }, [])

  const setStreamerMode = useCallback((on) => {
    setPrefs((p) => ({ ...p, streamerMode: !!on }))
  }, [])

  const value = useMemo(
    () => ({ ...prefs, toggleTheme, setStreamerMode }),
    [prefs, toggleTheme, setStreamerMode],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}
