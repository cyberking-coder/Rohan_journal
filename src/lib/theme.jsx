// App-wide preferences: theme, privacy, display and notification settings.
//
// Phase 0 introduced this as a theme-only provider; phase 4 grows it into the
// full Settings surface. It keeps the `ThemeProvider` / `useTheme` names so
// existing callers are unaffected, and adds `usePrefs` for everything else.
//
// Preferences live in localStorage so they apply instantly and survive a
// signed-out session. When Supabase is configured they are also mirrored to
// `profiles` (see supabase/phase4.sql) so they follow the user across devices.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'

const STORE_KEY = 'fgj_prefs'

export const DEFAULT_PREFS = {
  theme: 'dark',
  // Blurs every money figure so balances don't leak on a stream or a shared
  // screen. Hovering a value reveals it for the person actually at the desk.
  streamerMode: false,
  // Display symbol only — the spec is explicit that this does not convert P&L,
  // and inventing a conversion without an FX rate feed would be worse.
  currency: 'USD',
  // '' means "follow the browser".
  timezone: '',
  profileVisibility: 'private',
  notifications: {
    push: false,
    tradeAlerts: false,
    weeklyReport: false,
  },
  dismissedNotifications: [],
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const saved = JSON.parse(raw)
    // Merge rather than replace, so a preference added in a later release
    // doesn't come back undefined for existing users.
    return {
      ...DEFAULT_PREFS,
      ...saved,
      notifications: { ...DEFAULT_PREFS.notifications, ...(saved.notifications || {}) },
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

const PrefsContext = createContext({
  ...DEFAULT_PREFS,
  toggleTheme: () => {},
  setPref: () => {},
  setNotification: () => {},
  dismissNotification: () => {},
  restoreNotifications: () => {},
  resetPrefs: () => {},
})

export function ThemeProvider({ children, userId = null }) {
  const [prefs, setPrefs] = useState(load)
  const hydrated = useRef(false)

  // Reflect onto <html> so CSS can react without prop-drilling.
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', prefs.theme)
    root.setAttribute('data-streamer', prefs.streamerMode ? 'on' : 'off')
    try { localStorage.setItem(STORE_KEY, JSON.stringify(prefs)) } catch { /* private mode */ }
  }, [prefs])

  // Pull the saved profile once on sign-in. Local state wins until this
  // resolves so the UI never flickers back to defaults.
  useEffect(() => {
    if (!isSupabaseConfigured || !userId || hydrated.current) return
    let cancelled = false
    supabase.from('profiles').select('preferences').eq('id', userId).maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data?.preferences) return
        hydrated.current = true
        setPrefs((p) => ({
          ...p,
          ...data.preferences,
          notifications: { ...p.notifications, ...(data.preferences.notifications || {}) },
        }))
      })
      // A missing `profiles` table just means phase4.sql hasn't been applied;
      // localStorage still works, so this is not worth surfacing as an error.
      .catch(() => {})
    return () => { cancelled = true }
  }, [userId])

  // Every setter goes through here, so there is one place that writes state
  // and one place that mirrors it to Supabase.
  const update = useCallback((updater) => {
    setPrefs((current) => {
      const next = updater(current)
      if (next !== current && isSupabaseConfigured && userId) {
        supabase.from('profiles')
          .upsert({ id: userId, preferences: next, updated_at: new Date().toISOString() })
          .then(() => {}, () => {})
      }
      return next
    })
  }, [userId])

  const setPref = useCallback((key, value) => {
    update((p) => ({ ...p, [key]: value }))
  }, [update])

  const setNotification = useCallback((key, value) => {
    update((p) => ({ ...p, notifications: { ...p.notifications, [key]: value } }))
  }, [update])

  const toggleTheme = useCallback(() => {
    update((p) => ({ ...p, theme: p.theme === 'dark' ? 'light' : 'dark' }))
  }, [update])

  const dismissNotification = useCallback((id) => {
    update((p) => p.dismissedNotifications.includes(id)
      ? p
      : { ...p, dismissedNotifications: [...p.dismissedNotifications, id] })
  }, [update])

  const restoreNotifications = useCallback(() => {
    update((p) => ({ ...p, dismissedNotifications: [] }))
  }, [update])

  const resetPrefs = useCallback(() => {
    update(() => ({ ...DEFAULT_PREFS }))
  }, [update])

  const value = useMemo(() => ({
    ...prefs,
    toggleTheme, setPref, setNotification,
    dismissNotification, restoreNotifications, resetPrefs,
  }), [prefs, toggleTheme, setPref, setNotification, dismissNotification, restoreNotifications, resetPrefs])

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
}

export function usePrefs() {
  return useContext(PrefsContext)
}

// Kept for the components written in phase 0 that only care about the theme.
export const useTheme = usePrefs
