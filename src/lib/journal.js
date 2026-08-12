// Journal domain logic — the filtering, sorting and completeness rules behind
// the Journal split-pane, kept out of the component so they can be tested.

import { net } from './stats.js'
import { closeTime } from './analytics.js'

// The five structured fields, in the order the spec lays them out. Driving the
// form from this list keeps the schema, the UI and the "is it journaled?"
// check from drifting apart.
export const JOURNAL_FIELDS = [
  {
    key: 'pre_trade_analysis',
    label: 'Pre-Trade Analysis',
    placeholder: 'What did you see? Plan, thesis, levels, risk…',
  },
  {
    key: 'post_trade_review',
    label: 'Post-Trade Review',
    placeholder: 'What happened? Execution, slippage, improvements…',
  },
  {
    key: 'emotions',
    label: 'Emotions',
    placeholder: 'Calm, anxious, FOMO, confident…',
  },
  {
    key: 'lessons_learned',
    label: 'Lessons Learned',
    placeholder: 'Key takeaways to repeat or avoid…',
  },
]

export const JOURNAL_FIELD_KEYS = JOURNAL_FIELDS.map((f) => f.key)

// `is_journaled` is a generated column in Postgres, but the same rule has to
// hold client-side: for optimistic updates, and for the demo mode that has no
// database at all.
export function isJournaled(trade) {
  if (!trade) return false
  if (JOURNAL_FIELD_KEYS.some((k) => String(trade[k] ?? '').trim() !== '')) return true
  return trade.journal_rating != null
}

// The rating the app reads. Falls back to doubling the legacy 1-5 star value
// for rows written before the phase 3 migration.
export function journalRating(trade) {
  if (trade?.journal_rating != null) return Number(trade.journal_rating)
  if (trade?.rating != null) return Number(trade.rating) * 2
  return null
}

// How much of the journal is filled in — drives the completeness meter.
export function journalCompletion(trade) {
  const filled = JOURNAL_FIELD_KEYS.filter((k) => String(trade?.[k] ?? '').trim() !== '').length
  const total = JOURNAL_FIELD_KEYS.length + 1 // + the rating
  return Math.round(((filled + (trade?.journal_rating != null ? 1 : 0)) / total) * 100)
}

// ---------------------------------------------------------------------------
// List filtering and sorting
// ---------------------------------------------------------------------------

export const JOURNAL_TABS = [
  { key: 'all', label: 'All' },
  { key: 'journaled', label: 'Journaled' },
  { key: 'pending', label: 'Pending' },
]

export const JOURNAL_SORTS = {
  recent: { label: 'Newest first' },
  oldest: { label: 'Oldest first' },
  best: { label: 'Best P&L' },
  worst: { label: 'Worst P&L' },
}

export const DATE_FILTERS = {
  all: { label: 'All Time', days: Infinity },
  '7d': { label: 'Last 7 Days', days: 7 },
  '30d': { label: 'Last 30 Days', days: 30 },
  '90d': { label: 'Last 90 Days', days: 90 },
}

export function tabCounts(trades) {
  const journaled = trades.filter(isJournaled).length
  return { all: trades.length, journaled, pending: trades.length - journaled }
}

export function filterJournal(trades, { tab = 'all', query = '', dateFilter = 'all', sort = 'recent' } = {}) {
  const days = DATE_FILTERS[dateFilter]?.days ?? Infinity
  const cutoff = days === Infinity ? -Infinity : Date.now() - days * 86400000
  const q = query.trim().toLowerCase()

  const out = trades.filter((t) => {
    if (tab === 'journaled' && !isJournaled(t)) return false
    if (tab === 'pending' && isJournaled(t)) return false

    const at = closeTime(t)
    if (at !== null && at < cutoff) return false

    if (!q) return true
    // Symbol first, since that's what the spec's search box is for, but
    // matching the journal text too makes "what did I say about FOMO?"
    // answerable.
    const hay = [t.symbol, t.strategy, t.session, ...JOURNAL_FIELD_KEYS.map((k) => t[k])]
      .filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q)
  })

  const byTime = (a, b) => (closeTime(a) ?? 0) - (closeTime(b) ?? 0)
  const sorters = {
    recent: (a, b) => byTime(b, a),
    oldest: byTime,
    best: (a, b) => net(b) - net(a),
    worst: (a, b) => net(a) - net(b),
  }
  return out.sort(sorters[sort] ?? sorters.recent)
}

// ---------------------------------------------------------------------------
// Planned risk:reward
// ---------------------------------------------------------------------------

// Two inputs ("1 : 2") rather than one ratio, matching the spec. Returns null
// when the pair can't express a ratio, so the UI shows a dash instead of NaN.
export function plannedRatio(risk, reward) {
  const r = Number(risk)
  const w = Number(reward)
  if (!Number.isFinite(r) || !Number.isFinite(w) || r <= 0 || w <= 0) return null
  return w / r
}

export function fmtPlannedRatio(risk, reward) {
  const ratio = plannedRatio(risk, reward)
  if (ratio === null) return '—'
  const x = Math.round(ratio * 100) / 100
  return `1:${x % 1 === 0 ? x.toFixed(0) : x.toFixed(2)}`
}

// The colour of the 1-10 rating slider, red through amber to mint.
export function ratingColor(value) {
  if (value == null) return 'var(--text-3)'
  if (value <= 3) return 'var(--red)'
  if (value <= 6) return 'var(--amber)'
  return 'var(--mint)'
}
