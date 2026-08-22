// Trade tags — Master PRD §27.
//
// Two kinds of tag, and the distinction is the whole point:
//
//   concepts — what you saw. FVG, liquidity sweep, BOS, a kill zone.
//   mistakes — what you did. Moved a stop, revenge traded, oversized.
//
// A journal that only records concepts tells you which setups work. A journal
// that records mistakes tells you what is actually costing you money, which is
// usually a much shorter and more uncomfortable list. Both are needed, and
// they are reported separately because a trader wants different things from
// them: more of the first, none of the second.
//
// Tags are stored as slugs. The catalogue below gives the known ones a label
// and a category; anything not in it is a user's own tag and works exactly the
// same way, so the taxonomy can grow without a migration.

export const CATEGORIES = {
  concept: { label: 'Concept', hint: 'What you saw in the market.' },
  mistake: { label: 'Mistake', hint: 'What you did that you shouldn’t have.' },
  custom: { label: 'Custom', hint: 'Your own tags.' },
}

// ICT / SMC vocabulary as the PRD lists it, plus the handful of classical
// terms that traders using this vocabulary still reach for.
const CONCEPTS = [
  ['fvg', 'Fair Value Gap'],
  ['inversion-fvg', 'Inversion FVG'],
  ['order-block', 'Order Block'],
  ['breaker', 'Breaker Block'],
  ['mitigation-block', 'Mitigation Block'],
  ['liquidity-sweep', 'Liquidity Sweep'],
  ['liquidity-grab', 'Liquidity Grab'],
  ['equal-highs', 'Equal Highs'],
  ['equal-lows', 'Equal Lows'],
  ['bos', 'Break of Structure'],
  ['choch', 'Change of Character'],
  ['mss', 'Market Structure Shift'],
  ['premium', 'Premium Array'],
  ['discount', 'Discount Array'],
  ['ote', 'Optimal Trade Entry'],
  ['imbalance', 'Imbalance'],
  ['judas-swing', 'Judas Swing'],
  ['silver-bullet', 'Silver Bullet'],
  ['power-of-three', 'Power of Three'],
  ['asian-range', 'Asian Range'],
  ['london-killzone', 'London Kill Zone'],
  ['ny-killzone', 'New York Kill Zone'],
  ['london-close-killzone', 'London Close Kill Zone'],
  ['daily-bias', 'Daily Bias'],
  ['htf-alignment', 'HTF Alignment'],
  ['ltf-confirmation', 'LTF Confirmation'],
  ['news-driven', 'News Driven'],
  ['trend-continuation', 'Trend Continuation'],
  ['reversal', 'Reversal'],
  ['range', 'Range'],
  ['breakout', 'Breakout'],
  ['retest', 'Retest'],
]

// The mistakes that actually end accounts, phrased as the trader would say
// them rather than as a textbook would.
const MISTAKES = [
  ['no-setup', 'No Setup'],
  ['fomo', 'FOMO Entry'],
  ['revenge-trade', 'Revenge Trade'],
  ['overtrading', 'Overtrading'],
  ['oversized', 'Oversized'],
  ['no-stop', 'No Stop Loss'],
  ['moved-stop', 'Moved Stop'],
  ['early-exit', 'Exited Early'],
  ['late-entry', 'Late Entry'],
  ['chased-price', 'Chased Price'],
  ['against-bias', 'Against My Bias'],
  ['ignored-news', 'Ignored News'],
  ['no-confirmation', 'No Confirmation'],
  ['broke-rules', 'Broke My Rules'],
  ['held-through-news', 'Held Through News'],
  ['averaged-down', 'Averaged Down'],
  ['tilted', 'Traded on Tilt'],
]

export const CATALOGUE = [
  ...CONCEPTS.map(([slug, label]) => ({ slug, label, category: 'concept' })),
  ...MISTAKES.map(([slug, label]) => ({ slug, label, category: 'mistake' })),
]

const BY_SLUG = new Map(CATALOGUE.map((t) => [t.slug, t]))

/**
 * Turn free text into a slug.
 *
 * Deliberately lossy and stable: "Fair Value Gap", "fair-value-gap" and
 * "FVG " must not become three tags that never appear together in a report.
 */
export function slugify(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

// Common spellings that should land on an existing tag rather than create a
// near-duplicate beside it.
const ALIASES = {
  'fair-value-gap': 'fvg',
  'break-of-structure': 'bos',
  'change-of-character': 'choch',
  'market-structure-shift': 'mss',
  'optimal-trade-entry': 'ote',
  'ob': 'order-block',
  'sweep': 'liquidity-sweep',
  'liquidity-sweeps': 'liquidity-sweep',
  'killzone': 'ny-killzone',
  'revenge': 'revenge-trade',
  'revenge-trading': 'revenge-trade',
  'over-trading': 'overtrading',
  'over-sized': 'oversized',
  'no-sl': 'no-stop',
  'moved-sl': 'moved-stop',
  'early-exit-': 'early-exit',
  'tilt': 'tilted',
}

export function normaliseTag(input) {
  const s = slugify(input)
  if (!s) return null
  return ALIASES[s] || s
}

/** Deduplicated, normalised, order-preserving. */
export function normaliseTags(list) {
  const out = []
  const seen = new Set()
  for (const raw of list || []) {
    const t = normaliseTag(raw)
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  // A cap, because tags are an index and a trade tagged with thirty things is
  // tagged with nothing.
  return out.slice(0, 12)
}

export function tagInfo(slug) {
  return BY_SLUG.get(slug) || { slug, label: prettify(slug), category: 'custom' }
}

// Trading acronyms a user might type as a custom tag. Uppercasing every short
// word instead would be simpler and would turn "my setup" into "MY Setup" —
// short words are mostly just short words.
const ACRONYMS = new Set(['ict', 'smc', 'rr', 'atr', 'ema', 'sma', 'rsi', 'vwap',
  'cpi', 'nfp', 'fomc', 'htf', 'ltf', 'sl', 'tp', 'pd', 'poi', 'eq'])

function prettify(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
}

export function tagsOf(trade) {
  return Array.isArray(trade?.tags) ? trade.tags : []
}

/** Every tag actually in use, most-used first. Powers the picker's suggestions. */
export function usedTags(trades) {
  const counts = new Map()
  for (const t of trades || []) {
    for (const tag of tagsOf(t)) counts.set(tag, (counts.get(tag) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([slug, count]) => ({ ...tagInfo(slug), count }))
    .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1))
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export const MATCH_MODES = {
  any: { label: 'Any', hint: 'Trades carrying at least one of these tags.' },
  all: { label: 'All', hint: 'Trades carrying every one of these tags.' },
}

/**
 * Filter trades by tag.
 *
 * `all` is the mode that earns its keep: "FVG *and* moved-stop" is how you
 * find out that a setup which looks profitable is only profitable when you
 * leave it alone.
 */
export function filterByTags(trades, selected, mode = 'any') {
  const want = normaliseTags(selected)
  if (!want.length) return trades || []
  return (trades || []).filter((t) => {
    const has = new Set(tagsOf(t))
    return mode === 'all' ? want.every((w) => has.has(w)) : want.some((w) => has.has(w))
  })
}

// ---------------------------------------------------------------------------
// Performance by tag
// ---------------------------------------------------------------------------

import { net, realised } from './stats.js'

/**
 * How each tag has actually performed.
 *
 * A trade with three tags counts once toward each of them, so the rows do not
 * sum to the account total — they cannot, and reading them as a breakdown of
 * total P&L is the one way to misuse this table. Each row answers "how do
 * trades carrying this tag do", nothing more.
 *
 * `minTrades` exists because the top of this table, unfiltered, is always a
 * tag used twice that happened to win twice. That is noise presented as
 * insight, and it is the failure mode of every tag report.
 */
export function tagPerformance(trades, { minTrades = 1 } = {}) {
  const closed = realised(trades || [])
  const buckets = new Map()

  for (const t of closed) {
    for (const slug of tagsOf(t)) {
      if (!buckets.has(slug)) buckets.set(slug, [])
      buckets.get(slug).push(t)
    }
  }

  const rows = []
  for (const [slug, list] of buckets) {
    if (list.length < minTrades) continue
    const wins = list.filter((t) => net(t) > 0)
    const losses = list.filter((t) => net(t) < 0)
    const grossWin = wins.reduce((s, t) => s + net(t), 0)
    const grossLoss = Math.abs(losses.reduce((s, t) => s + net(t), 0))
    const total = list.reduce((s, t) => s + net(t), 0)

    rows.push({
      ...tagInfo(slug),
      trades: list.length,
      wins: wins.length,
      losses: losses.length,
      winRate: list.length ? (wins.length / list.length) * 100 : 0,
      pnl: total,
      avg: list.length ? total / list.length : 0,
      // Infinity when there are no losers at all — a real answer, and the UI
      // renders it as ∞ rather than pretending it is a number.
      profitFactor: grossLoss ? grossWin / grossLoss : grossWin ? Infinity : 0,
      best: list.reduce((m, t) => Math.max(m, net(t)), -Infinity),
      worst: list.reduce((m, t) => Math.min(m, net(t)), Infinity),
    })
  }

  return rows.sort((a, b) => b.pnl - a.pnl)
}

export function byCategory(rows, category) {
  return rows.filter((r) => r.category === category)
}

/**
 * What the mistake tags have cost.
 *
 * Reported as its own figure because it is the number that changes behaviour.
 * "Your FVG trades make $4,200" is interesting; "moving your stop has cost you
 * $3,100 across 14 trades" is actionable, and the second is what a trader
 * needs to be shown without going looking for it.
 *
 * Counts each trade once no matter how many mistakes are tagged on it —
 * otherwise a single bad trade with three mistake tags would be charged three
 * times and the total would be fiction.
 */
export function mistakeCost(trades) {
  const closed = realised(trades || [])
  const tagged = closed.filter((t) =>
    tagsOf(t).some((slug) => tagInfo(slug).category === 'mistake'))

  const cost = tagged.reduce((s, t) => s + net(t), 0)
  const losing = tagged.filter((t) => net(t) < 0)

  return {
    trades: tagged.length,
    // Share of all closed trades that carry a mistake — the honest headline,
    // since a trader with a 40% mistake rate has a process problem regardless
    // of what those trades made.
    share: closed.length ? (tagged.length / closed.length) * 100 : 0,
    pnl: cost,
    losses: losing.length,
    lostAmount: Math.abs(losing.reduce((s, t) => s + net(t), 0)),
    // What the account would look like without them. Not a promise — those
    // trades might have been replaced by others — but it is the comparison
    // every trader makes anyway, so it may as well be computed correctly.
    withoutThem: closed.reduce((s, t) => s + net(t), 0) - cost,
  }
}
