// AI report: quota arithmetic, trade summarisation and report shaping.
//
// Everything here is pure so it can be unit-tested and, more importantly, so
// the *same* week-boundary rule runs in the browser (to draw the reset timer)
// and in the edge function (to enforce the quota). Two implementations of
// "when does the week roll over" would eventually disagree, and the one the
// user sees would be the wrong one.

import { net } from './stats.js'
import { closeTime } from './analytics.js'
import { isJournaled, journalRating } from './journal.js'

// Reports allowed per user per week. The spec calls for a small allowance with
// a visible reset timer rather than a hard paywall.
export const WEEKLY_QUOTA = 3

const DAY = 86400000

// ---------------------------------------------------------------------------
// The week
// ---------------------------------------------------------------------------

/**
 * Monday 00:00 UTC of the week containing `ms`.
 *
 * UTC, not the user's timezone: the quota is a billing-shaped fact, and a
 * traveller crossing a date line should not gain or lose a report. The UI is
 * explicit that the reset is UTC so the timer never looks broken.
 */
export function weekStart(ms = Date.now()) {
  const d = new Date(ms)
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  // getUTCDay: Sunday 0 … Saturday 6. Sunday belongs to the week that began
  // six days earlier, not to the one starting tomorrow.
  const back = (new Date(utc).getUTCDay() + 6) % 7
  return utc - back * DAY
}

/** ISO date (YYYY-MM-DD) of the week bucket — matches `ai_reports.week_start`. */
export function weekStartKey(ms = Date.now()) {
  return new Date(weekStart(ms)).toISOString().slice(0, 10)
}

/** Milliseconds until the quota resets. */
export function msUntilReset(ms = Date.now()) {
  return weekStart(ms) + 7 * DAY - ms
}

/** "2d 4h" / "4h 12m" / "12m" — coarse on purpose; a ticking second hand on a
 *  week-long timer is noise. */
export function formatReset(msLeft) {
  if (!Number.isFinite(msLeft) || msLeft <= 0) return 'now'
  const m = Math.floor(msLeft / 60000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  const mm = m % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${mm}m`
  return `${mm}m`
}

/**
 * Quota state for a set of reports the client already holds.
 *
 * The client copy is advisory — it greys the button and draws the timer. The
 * edge function runs the same count against the database before spending
 * anything, and that count is the one that decides.
 */
export function quotaState(reports = [], now = Date.now(), limit = WEEKLY_QUOTA) {
  const key = weekStartKey(now)
  const used = reports.filter((r) => reportWeekKey(r) === key).length
  const remaining = Math.max(0, limit - used)
  return {
    used, limit, remaining,
    exhausted: remaining === 0,
    resetsAt: weekStart(now) + 7 * DAY,
    resetsIn: msUntilReset(now),
  }
}

// `week_start` is authoritative; falling back to created_at keeps rows written
// before this column existed (or by hand) from being invisible to the count.
function reportWeekKey(report) {
  if (report?.week_start) return String(report.week_start).slice(0, 10)
  const t = Date.parse(report?.created_at || '')
  return Number.isFinite(t) ? weekStartKey(t) : ''
}

// ---------------------------------------------------------------------------
// What the model is shown
// ---------------------------------------------------------------------------

/**
 * Condenses trade history into the compact record the prompt is built from.
 *
 * Sending raw rows would waste most of the context on ids and nulls, and would
 * ship fields the model has no use for. This keeps only what a reviewer would
 * actually reason about — and deliberately keeps the journal notes, since a
 * report written without the trader's own reasoning is just restated numbers.
 */
export function summariseTrades(trades = [], { limit = 120 } = {}) {
  const sorted = [...trades]
    .filter(Boolean)
    .sort((a, b) => closeTime(a) - closeTime(b))
  const recent = sorted.slice(-limit)

  const pnl = recent.map(net)
  const wins = pnl.filter((p) => p > 0)
  const losses = pnl.filter((p) => p < 0)
  const total = pnl.reduce((s, p) => s + p, 0)

  const bySymbol = {}
  for (const t of recent) {
    const k = (t.symbol || 'UNKNOWN').toUpperCase()
    const s = bySymbol[k] || (bySymbol[k] = { symbol: k, trades: 0, net: 0, wins: 0 })
    s.trades++
    s.net += net(t)
    if (net(t) > 0) s.wins++
  }

  return {
    count: recent.length,
    // Says plainly when the tail was cut, so the model doesn't describe a
    // window it wasn't given.
    truncatedFrom: sorted.length > recent.length ? sorted.length : null,
    periodStart: recent.length ? new Date(closeTime(recent[0])).toISOString() : null,
    periodEnd: recent.length ? new Date(closeTime(recent[recent.length - 1])).toISOString() : null,
    netPnl: round2(total),
    winRate: recent.length ? round2((wins.length / recent.length) * 100) : 0,
    wins: wins.length,
    losses: losses.length,
    avgWin: wins.length ? round2(wins.reduce((s, p) => s + p, 0) / wins.length) : 0,
    avgLoss: losses.length ? round2(losses.reduce((s, p) => s + p, 0) / losses.length) : 0,
    largestWin: wins.length ? round2(Math.max(...wins)) : 0,
    largestLoss: losses.length ? round2(Math.min(...losses)) : 0,
    journaledCount: recent.filter(isJournaled).length,
    symbols: Object.values(bySymbol)
      .map((s) => ({ ...s, net: round2(s.net) }))
      .sort((a, b) => b.trades - a.trades)
      .slice(0, 12),
    trades: recent.map((t) => ({
      date: new Date(closeTime(t)).toISOString().slice(0, 10),
      symbol: (t.symbol || '').toUpperCase(),
      direction: t.direction || t.side || null,
      pnl: round2(net(t)),
      rating: journalRating(t),
      // Long-form notes are truncated: a handful of very wordy entries should
      // not crowd out fifty other trades.
      setup: clip(t.setup, 200),
      mistakes: clip(t.mistakes, 200),
      lessons: clip(t.lessons, 200),
      emotions: clip(t.emotions, 120),
      notes: clip(t.notes, 200),
    })),
  }
}

function clip(value, max) {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!s) return null
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function round2(n) {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

// ---------------------------------------------------------------------------
// What comes back
// ---------------------------------------------------------------------------

export const TONES = {
  positive: { label: 'Strength', color: 'var(--mint)' },
  warning: { label: 'Watch', color: 'var(--amber)' },
  critical: { label: 'Fix', color: 'var(--red)' },
  neutral: { label: 'Note', color: 'var(--text-2)' },
}

export function toneMeta(tone) {
  return TONES[tone] || TONES.neutral
}

/**
 * Normalises a stored row (or a fresh function response) into what the page
 * renders. Old rows, hand-inserted rows and a model that drifted from the
 * schema all have to render as *something* rather than crashing the archive.
 */
export function shapeReport(row) {
  if (!row) return null
  const raw = row.sections
  const sections = (Array.isArray(raw) ? raw : safeParse(raw))
    .filter((s) => s && (s.heading || s.body))
    .map((s) => ({
      heading: String(s.heading || 'Note'),
      body: String(s.body || ''),
      tone: TONES[s.tone] ? s.tone : 'neutral',
    }))

  return {
    id: row.id,
    title: row.title || 'Performance review',
    summary: row.summary || '',
    sections,
    createdAt: Date.parse(row.created_at || '') || null,
    periodStart: Date.parse(row.period_start || '') || null,
    periodEnd: Date.parse(row.period_end || '') || null,
    tradeCount: Number(row.trade_count) || 0,
    model: row.model || null,
  }
}

function safeParse(value) {
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Fewer than this and there is nothing to review — say so instead of asking
 *  the model to invent insight from three trades. */
export const MIN_TRADES = 5

export function canGenerate({ trades = [], quota, generating = false }) {
  if (generating) return { ok: false, reason: 'Generating…' }
  if (trades.length < MIN_TRADES) {
    return { ok: false, reason: `Log at least ${MIN_TRADES} trades first — you have ${trades.length}.` }
  }
  if (quota?.exhausted) {
    return { ok: false, reason: `Weekly limit reached. Resets in ${formatReset(quota.resetsIn)}.` }
  }
  return { ok: true, reason: '' }
}
