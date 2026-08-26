// Community — Phase 10.
//
// ── What this feature is allowed to publish ────────────────────────────────
// Ratios, counts and R-multiples. Never currency, never account size, never a
// balance. That rule is enforced in the database (supabase/community.sql), and
// it is repeated here because this file computes the snapshot a user attaches
// to a published setup, and a mistake here would put a dollar figure into a
// public payload from the client side.
//
// The rule is a privacy decision first. It is also the strongest anti-gaming
// measure available: there is nothing to win by claiming a big account when
// account size is not a thing anybody can see.
//
// ── On what can and cannot be verified ─────────────────────────────────────
// Manually entered trades are self-reported. Nothing here can check them, and
// pretending otherwise would be the real failure — a leaderboard that implies
// verification it does not have is worse than one that admits the limit. So
// every published figure carries whether its sample came entirely from broker
// sync, and one manual entry removes the badge.

import { net, realised } from './stats.js'
import { closeTime } from './analytics.js'
import { isSynced } from './accounts.js'
import { normaliseTags } from './tags.js'

// Mirrors the thresholds in `leaderboard()`. The database decides; this copy
// is so the UI can tell someone why they are not on the board yet, which is a
// question they will otherwise ask support.
export const MIN_TRADES = 20
export const MIN_DAYS = 10

export const HANDLE_RULE = /^[a-zA-Z0-9_]{3,20}$/

/**
 * Is this a usable handle?
 *
 * Returns a reason rather than a boolean, because "invalid handle" with no
 * explanation is the kind of form error people abandon a signup over.
 */
export function checkHandle(input) {
  const handle = String(input || '').trim()
  if (!handle) return { ok: false, reason: 'Pick a handle — it’s what other traders will see.' }
  if (handle.length < 3) return { ok: false, reason: 'At least 3 characters.' }
  if (handle.length > 20) return { ok: false, reason: 'At most 20 characters.' }
  if (!HANDLE_RULE.test(handle)) {
    return { ok: false, reason: 'Letters, numbers and underscores only.' }
  }
  // Not a security control — anyone can pick a confusing name — but it stops
  // the most obvious impersonation attempts from being effortless.
  if (/^(admin|moderator|support|official|staff|system)$/i.test(handle)) {
    return { ok: false, reason: 'That handle is reserved.' }
  }
  return { ok: true, handle }
}

// ---------------------------------------------------------------------------
// The R unit
// ---------------------------------------------------------------------------

/**
 * The average losing trade, which is what every published figure is divided
 * by.
 *
 * Same definition as `shared_view()` in phase9.sql and as `leaderboard()`.
 * Three copies of one rule is two too many, but the alternative is the client
 * being unable to show a preview of what it is about to publish — so they are
 * written to look alike, and the database's copy is the one that decides.
 *
 * Returns null rather than 1 when there are no losing trades. A trader with no
 * losses has an undefined R, and substituting 1 would silently publish a
 * figure computed against a made-up denominator.
 */
export function rUnit(trades) {
  const losers = realised(trades).filter((t) => net(t) < 0)
  if (!losers.length) return null
  const total = losers.reduce((s, t) => s + Math.abs(net(t)), 0)
  const unit = total / losers.length
  return unit > 0 ? unit : null
}

/**
 * The publishable summary of a set of trades.
 *
 * Everything returned is a ratio, a count or an R-multiple. If a currency
 * value ever appears in this object, it will end up on somebody's public
 * profile — the test suite asserts the shape for that reason.
 */
export function publishableStats(trades) {
  const closed = realised(trades || [])
  const unit = rUnit(closed)

  const wins = closed.filter((t) => net(t) > 0)
  const losses = closed.filter((t) => net(t) < 0)
  const grossWin = wins.reduce((s, t) => s + net(t), 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + net(t), 0))
  const total = closed.reduce((s, t) => s + net(t), 0)

  const times = closed.map(closeTime).filter((v) => v !== null).sort((a, b) => a - b)
  const days = new Set(times.map((ms) => Math.floor(ms / 86400000)))

  return {
    trades: closed.length,
    winRate: closed.length ? round((wins.length / closed.length) * 100, 1) : 0,
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : null,
    // Null, not Infinity and not 0, when R is undefined. The UI shows a dash
    // and says why rather than printing a number nobody can interpret.
    expectancyR: unit ? round((total / closed.length) / unit, 3) : null,
    tradingDays: days.size,
    from: times.length ? new Date(times[0]).toISOString() : null,
    to: times.length ? new Date(times[times.length - 1]).toISOString() : null,
    // Every trade, not most. One manual entry is all it takes to change the
    // numbers, so one manual entry removes the badge.
    verified: closed.length > 0 && closed.every(isSynced),
  }
}

function round(n, places) {
  const f = 10 ** places
  return Number.isFinite(n) ? Math.round(n * f) / f : null
}

/**
 * Why someone is or isn't eligible for the leaderboard.
 *
 * The thresholds exist because a leaderboard's natural top is a trader with
 * four trades and a 100% win rate — noise presented as achievement, and
 * trivial to manufacture. Told as a checklist so the answer to "why am I not
 * on this" is on screen.
 */
export function eligibility(trades) {
  const stats = publishableStats(trades)
  const reasons = []

  if (stats.trades < MIN_TRADES) {
    reasons.push(`${MIN_TRADES - stats.trades} more closed trade${MIN_TRADES - stats.trades === 1 ? '' : 's'}`)
  }
  if (stats.tradingDays < MIN_DAYS) {
    reasons.push(`${MIN_DAYS - stats.tradingDays} more trading day${MIN_DAYS - stats.tradingDays === 1 ? '' : 's'}`)
  }
  if (stats.expectancyR === null) {
    reasons.push('at least one losing trade, so a risk unit can be worked out')
  }

  return { ...stats, eligible: reasons.length === 0, missing: reasons }
}

// ---------------------------------------------------------------------------
// Setups
// ---------------------------------------------------------------------------

export const REPORT_REASONS = {
  spam: 'Spam or advertising',
  misleading: 'Misleading or fabricated results',
  abusive: 'Abusive content',
  impersonation: 'Impersonating someone',
  other: 'Something else',
}

export const TITLE_MAX = 120
export const THESIS_MIN = 20
export const THESIS_MAX = 4000

/**
 * Validate a setup before it is published.
 *
 * Mirrors the CHECK constraints in the migration. Doing it here as well is not
 * duplication for its own sake: a constraint violation surfaces as a Postgres
 * error string, and "new row violates check constraint shared_setups_thesis_len"
 * is not something to show a person.
 */
export function validateSetup(draft) {
  const errors = {}
  const title = String(draft?.title || '').trim()
  const thesis = String(draft?.thesis || '').trim()

  if (title.length < 3) errors.title = 'Give it a title.'
  else if (title.length > TITLE_MAX) errors.title = `At most ${TITLE_MAX} characters.`

  if (thesis.length < THESIS_MIN) {
    errors.thesis = `Explain the idea — at least ${THESIS_MIN} characters.`
  } else if (thesis.length > THESIS_MAX) {
    errors.thesis = `At most ${THESIS_MAX.toLocaleString()} characters.`
  }

  const tags = normaliseTags(draft?.tags)
  const symbols = normaliseSymbols(draft?.symbols)

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    clean: { title, thesis, tags, symbols, timeframe: draft?.timeframe || null },
  }
}

export function normaliseSymbols(list) {
  const out = []
  const seen = new Set()
  for (const raw of list || []) {
    const s = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9.]/g, '')
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out.slice(0, 8)
}

/**
 * How to describe a published sample's trustworthiness in one line.
 *
 * Said on every card. The point is that a reader should never have to guess
 * whether the numbers in front of them were checked by anything.
 */
export function describeProvenance(entry) {
  if (entry?.stat_verified ?? entry?.verified) {
    return {
      tone: 'good',
      text: 'Every trade in this sample came from a synced broker account.',
      short: 'Synced',
    }
  }
  return {
    tone: 'neutral',
    text: 'Some or all of these trades were entered by hand and can’t be verified.',
    short: 'Self-reported',
  }
}

/**
 * Rank entries for display.
 *
 * The database already orders by expectancy. Re-sorting here would be
 * redundant; what this adds is the position number and the tie handling —
 * two identical scores should share a rank rather than one being arbitrarily
 * ahead.
 */
export function withRanks(entries) {
  let lastScore = null
  let lastRank = 0
  return (entries || []).map((e, i) => {
    const score = e.expectancy_r
    const rank = score === lastScore ? lastRank : i + 1
    lastScore = score
    lastRank = rank
    return { ...e, rank }
  })
}
