import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      // Demo mode (no Supabase): run without auth on local data.
      setLoading(false)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function signInWithGoogle() {
    if (!isSupabaseConfigured) return
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  }

  // `scope: 'global'` revokes every refresh token for the user, signing them
  // out on all devices — that's what Settings → Security offers. The default
  // 'local' only ends this browser's session.
  async function signOut({ scope = 'local' } = {}) {
    if (!isSupabaseConfigured) return
    await supabase.auth.signOut({ scope })
    setSession(null)
  }

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    signInWithGoogle,
    signOut,
    // In demo mode auth is bypassed; treat as "signed in".
    requiresAuth: isSupabaseConfigured,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
