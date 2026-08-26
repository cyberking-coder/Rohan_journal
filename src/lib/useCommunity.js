import { useCallback, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'
import { checkHandle, validateSetup } from './community'

/**
 * The community feature's data access — Phase 10.
 *
 * Two things to notice about the shape of this file:
 *
 * 1. Reads of *other people's* data go through `rpc()`, never through
 *    `.from()`. There is no table policy that would let a select on
 *    `shared_setups` return somebody else's row, which is deliberate: the
 *    functions are the only door, exactly as in phase 9.
 *
 * 2. The opt-in is a row that may not exist. Absence is the default state and
 *    means "not participating" — so a missing row is never an error here, and
 *    nothing writes one speculatively.
 */
export function useCommunity(userId) {
  const [profile, setProfile] = useState(null)
  const [setups, setSetups] = useState([])          // the user's own, drafts included
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    if (!isSupabaseConfigured || !userId) {
      setProfile(null); setSetups([]); setReady(false); setLoading(false)
      return
    }

    const { data: prof, error: profErr } = await supabase
      .from('community_profiles').select('*').eq('user_id', userId).maybeSingle()

    if (profErr) {
      const missing = /relation .* does not exist|schema cache/i.test(profErr.message || '')
      setError(missing ? null : profErr.message)
      setReady(!missing)
      setProfile(null); setSetups([]); setLoading(false)
      return
    }

    setProfile(prof || null)
    setReady(true)
    setError(null)

    const { data: mine } = await supabase
      .from('shared_setups').select('*').order('created_at', { ascending: false })
    setSetups(mine || [])
    setLoading(false)
  }, [userId])

  useEffect(() => { refresh() }, [refresh])

  /**
   * Join, or update the opt-in.
   *
   * Note that `suspended` is never sent. A trigger rejects any attempt to
   * change it, so including it would turn every save into an error — but the
   * more important point is that it must not be in the client's vocabulary at
   * all.
   */
  const saveProfile = useCallback(async ({ handle, bio, onLeaderboard, publishes }) => {
    setError(null)
    const check = checkHandle(handle)
    if (!check.ok) { setError(check.reason); return null }

    const row = {
      user_id: userId,
      handle: check.handle,
      bio: bio?.trim() || null,
      on_leaderboard: !!onLeaderboard,
      publishes: !!publishes,
    }

    const { data, error: err } = await supabase
      .from('community_profiles').upsert(row, { onConflict: 'user_id' }).select().single()

    if (err) {
      // The unique index on lower(handle) is the common failure and deserves a
      // sentence rather than a Postgres error string.
      setError(/duplicate key|unique/i.test(err.message)
        ? 'That handle is taken — try another.'
        : err.message)
      return null
    }
    setProfile(data)
    return data
  }, [userId])

  /**
   * Leave.
   *
   * Deletes the profile, which cascades the setups away with it. Offered
   * plainly because a community feature you cannot leave is one people are
   * right to be wary of joining.
   */
  const leave = useCallback(async () => {
    setError(null)
    const { error: err } = await supabase
      .from('community_profiles').delete().eq('user_id', userId)
    if (err) { setError(err.message); return false }
    setProfile(null)
    setSetups([])
    return true
  }, [userId])

  const saveSetup = useCallback(async (draft) => {
    setError(null)
    const v = validateSetup(draft)
    if (!v.ok) { setError(Object.values(v.errors)[0]); return null }

    const row = {
      user_id: userId,
      title: v.clean.title,
      thesis: v.clean.thesis,
      tags: v.clean.tags,
      symbols: v.clean.symbols,
      timeframe: v.clean.timeframe,
      published: !!draft.published,
      // The stats snapshot is computed by the caller from its own trades and
      // frozen here. Not recomputed later, on purpose — a write-up says "this
      // is how it went over these trades", and quietly updating those numbers
      // would rewrite a claim made at a point in time.
      stat_trades: draft.stats?.trades ?? 0,
      stat_win_rate: draft.stats?.winRate ?? null,
      stat_profit_factor: draft.stats?.profitFactor ?? null,
      stat_expectancy_r: draft.stats?.expectancyR ?? null,
      stat_from: draft.stats?.from ?? null,
      stat_to: draft.stats?.to ?? null,
      stat_verified: !!draft.stats?.verified,
    }

    const q = draft.id
      ? supabase.from('shared_setups').update(row).eq('id', draft.id).select().single()
      : supabase.from('shared_setups').insert(row).select().single()

    const { data, error: err } = await q
    if (err) { setError(err.message); return null }

    setSetups((prev) => (draft.id
      ? prev.map((s) => (s.id === data.id ? data : s))
      : [data, ...prev]))
    return data
  }, [userId])

  const removeSetup = useCallback(async (id) => {
    setSetups((prev) => prev.filter((s) => s.id !== id))
    const { error: err } = await supabase.from('shared_setups').delete().eq('id', id)
    if (err) { setError(err.message); refresh() }
  }, [refresh])

  return {
    profile, setups, loading, ready, error,
    saveProfile, leave, saveSetup, removeSetup, refresh,
    clearError: () => setError(null),
  }
}

/**
 * The public side: the leaderboard and other people's setups.
 *
 * Separate hook because it has a different lifecycle — it is read on demand
 * and does not depend on the user having joined. Someone can look before they
 * decide whether to opt in, which is the order people actually want.
 */
export function useCommunityFeed(periodDays = 30) {
  const [board, setBoard] = useState(null)
  const [feed, setFeed] = useState([])
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    if (!isSupabaseConfigured) {
      setBoard(null); setFeed([]); setReady(false); setLoading(false)
      return
    }

    const [{ data: lb, error: lbErr }, { data: setups }] = await Promise.all([
      supabase.rpc('leaderboard', { p_days: periodDays, p_limit: 50 }),
      supabase.rpc('browse_setups', { p_tag: null, p_limit: 30 }),
    ])

    if (lbErr) {
      const missing = /function .* does not exist|schema cache/i.test(lbErr.message || '')
      setError(missing
        ? 'The community isn’t set up on this deployment yet — supabase/community.sql hasn’t been run.'
        : lbErr.message)
      setReady(false)
    } else {
      setBoard(lb || null)
      setFeed(setups || [])
      setReady(true)
      setError(null)
    }
    setLoading(false)
  }, [periodDays])

  useEffect(() => { load() }, [load])

  /**
   * Report a setup.
   *
   * The insert may collide with the unique (reporter, setup) constraint, which
   * is not an error worth surfacing: the user has already reported it, and
   * telling them so is the honest response rather than silently accepting a
   * second one.
   */
  const report = useCallback(async (setupId, reason, detail) => {
    const { error: err } = await supabase.from('content_reports').insert({
      setup_id: setupId, reason, detail: detail?.trim() || null,
    })
    if (err && /duplicate key|unique/i.test(err.message)) {
      return { ok: true, already: true }
    }
    if (err) return { ok: false, error: err.message }
    return { ok: true }
  }, [])

  return { board, feed, loading, ready, error, refresh: load, report }
}
