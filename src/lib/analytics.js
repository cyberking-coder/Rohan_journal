// Filterable analytics core.
//
// Every widget in the spec's Analysis module reacts to the same two filter
// states — a time period and a trade type — so the filtering lives here once
// rather than being re-derived per widget. Phase 1 builds the widgets on top
// of `computeAnalytics`; `stats.js` keeps the older helpers the current
// Dashboard/Analysis pages still use.

import { net } from './stats.js'

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export const PERIODS = {
  today: { label: 'Today', days: 0 },
  '7d': { label: '7 Days', days: 7 },
  '30d': { label: '30 Days', days: 30 },
  '3m': { label: '3 Months', days: 90 },
  '1y': { label: '1 Year', days: 365 },
  all: { label: 'All Time', days: Infinity },
}

export const PERIOD_KEYS = Object.keys(PERIODS)
export const DEFAULT_PERIOD = '30d'

export const TRADE_TYPES = {
  all: { label: 'All Trades' },
  winners: { label: 'Winners' },
  losers: { label: 'Losers' },
}

export const TRADE_TYPE_KEYS = Object.keys(TRADE_TYPES)
export const DEFAULT_TRADE_TYPE = 'all'

// The trade's close time is what every period and day bucket keys off — these
// are closed trades, so the close is when the P&L actually landed. `traded_at`
// is the current schema's close timestamp; `closed_at` is the Phase 0 column
// that will carry it once broker sync distinguishes open from close.
export function closeTime(trade) {
  const raw = trade.closed_at || trade.traded_at
  const ms = new Date(raw).getTime()
  return Number.isFinite(ms) ? ms : null
}

export function openTime(trade) {
  const raw = trade.opened_at || trade.traded_at
  const ms = new Date(raw).getTime()
  return Number.isFinite(ms) ? ms : null
}

export function isOpen(trade) {
  return trade.status === 'open'
}

function periodCutoff(periodKey) {
  const period = PERIODS[periodKey] ?? PERIODS[DEFAULT_PERIOD]
  if (period.days === Infinity) return -Infinity
  if (period.days === 0) {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return start.getTime()
  }
  return Date.now() - period.days * 86400000
}

export function filterTrades(trades, { period = DEFAULT_PERIOD, tradeType = DEFAULT_TRADE_TYPE } = {}) {
  const cutoff = periodCutoff(period)
  return trades.filter((t) => {
    const closed = closeTime(t)
    if (closed === null || closed < cutoff) return false
    if (tradeType === 'winners') return net(t) > 0
    if (tradeType === 'losers') return net(t) < 0
    return true
  })
}

// ---------------------------------------------------------------------------
// Core metrics
// ---------------------------------------------------------------------------

// Bands drive the qualitative label next to Profit Factor. The spec flags the
// live app's exact thresholds as unconfirmed, so this stays a tunable table.
export const PROFIT_FACTOR_BANDS = [
  { min: 2.0, label: 'Excellent', tone: 'good' },
  { min: 1.5, label: 'Good', tone: 'good' },
  { min: 1.0, label: 'Fair', tone: 'neutral' },
  { min: -Infinity, label: 'Needs work', tone: 'bad' },
]

export function profitFactorLabel(pf) {
  if (!Number.isFinite(pf)) return { label: 'Excellent', tone: 'good' }
  return PROFIT_FACTOR_BANDS.find((b) => pf >= b.min) ?? PROFIT_FACTOR_BANDS[PROFIT_FACTOR_BANDS.length - 1]
}

// Longest run of consecutive values satisfying `predicate`, in chronological
// order. Used for both trade streaks and day streaks.
export function longestStreak(values, predicate) {
  let best = 0
  let run = 0
  for (const v of values) {
    if (predicate(v)) {
      run += 1
      if (run > best) best = run
    } else {
      run = 0
    }
  }
  return best
}

// Running cumulative P&L, ordered by close time. The starting $0 point is not
// included — each entry is a realised trade.
export function cumulativeEquity(trades) {
  const sorted = [...trades].sort((a, b) => (closeTime(a) ?? 0) - (closeTime(b) ?? 0))
  let running = 0
  return sorted.map((t) => {
    running += net(t)
    return { at: closeTime(t), equity: running, trade: t }
  })
}

// Drawdown at each point: distance below the running peak. Always <= 0.
export function drawdownSeries(trades) {
  let peak = 0
  return cumulativeEquity(trades).map((p) => {
    if (p.equity > peak) peak = p.equity
    return { ...p, peak, drawdown: p.equity - peak }
  })
}

// Deepest peak-to-trough decline, plus the peak it fell from so the percentage
// has a meaningful denominator.
//
// Note: the live app shows "Max drawdown %" as 0% even when a dollar drawdown
// exists. The spec calls that a bug and tells us not to replicate it, so this
// returns the real percentage.
export function maxDrawdown(trades) {
  let peak = 0
  let worst = 0
  let peakAtWorst = 0
  for (const p of cumulativeEquity(trades)) {
    if (p.equity > peak) peak = p.equity
    const dd = p.equity - peak
    if (dd < worst) {
      worst = dd
      peakAtWorst = peak
    }
  }
  // Percentage is only meaningful when equity had climbed above the starting
  // point first; from a $0 start with no gains there is no base to divide by.
  const pct = peakAtWorst > 0 ? (Math.abs(worst) / peakAtWorst) * 100 : null
  return { amount: worst, peak: peakAtWorst, pct }
}

function dayKey(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Per-calendar-day totals, chronological. Feeds the day-level stats and the
// trading calendar heatmap.
export function dailyTotals(trades) {
  const map = new Map()
  for (const t of trades) {
    const at = closeTime(t)
    if (at === null) continue
    const key = dayKey(at)
    const cur = map.get(key) || { date: key, pnl: 0, count: 0, wins: 0, trades: [] }
    cur.pnl += net(t)
    cur.count += 1
    if (net(t) > 0) cur.wins += 1
    cur.trades.push(t)
    map.set(key, cur)
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

// Per-calendar-month totals, chronological. Feeds the Dashboard's monthly
// strip and the "best / worst / average month" cards.
export function monthlyTotals(trades) {
  const map = new Map()
  for (const t of trades) {
    const at = closeTime(t)
    if (at === null) continue
    const d = new Date(at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const cur = map.get(key) || {
      key,
      label: d.toLocaleDateString(undefined, { month: 'short' }),
      year: d.getFullYear(),
      pnl: 0,
      count: 0,
    }
    cur.pnl += net(t)
    cur.count += 1
    map.set(key, cur)
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key))
}

// Realised P&L split by whether the position is still open. "Unrealized" only
// means anything once broker sync reports live positions (phase 5); until then
// it is legitimately zero rather than fabricated.
export function realisedSplit(trades) {
  const open = trades.filter(isOpen)
  const closed = trades.filter((t) => !isOpen(t))
  return {
    realised: closed.reduce((s, t) => s + net(t), 0),
    unrealised: open.reduce((s, t) => s + net(t), 0),
    openCount: open.length,
    closedCount: closed.length,
  }
}

function avg(nums) {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0
}

function holdMinutes(trade) {
  const open = openTime(trade)
  const close = closeTime(trade)
  if (open === null || close === null || close <= open) return null
  return (close - open) / 60000
}

/**
 * The full metric set the Analysis module needs, computed once from an
 * already-filtered trade list.
 *
 * @param {Array} trades   trades that already passed `filterTrades`
 * @param {Array} allTrades  unfiltered list, used only for open-position counts
 *                           (open trades have no close time, so the period
 *                           filter would otherwise drop them)
 */
export function computeAnalytics(trades, allTrades = trades) {
  const closed = trades.filter((t) => !isOpen(t))
  const pnls = closed.map(net)
  const wins = closed.filter((t) => net(t) > 0)
  const losses = closed.filter((t) => net(t) < 0)
  const breakEven = closed.filter((t) => net(t) === 0)

  const grossProfit = wins.reduce((s, t) => s + net(t), 0)
  const grossLoss = losses.reduce((s, t) => s + net(t), 0) // negative
  const totalPnl = grossProfit + grossLoss

  const avgWin = avg(wins.map(net))
  const avgLoss = avg(losses.map(net)) // negative
  const profitFactor = grossLoss !== 0
    ? grossProfit / Math.abs(grossLoss)
    : grossProfit > 0 ? Infinity : 0

  const chronological = [...closed].sort((a, b) => (closeTime(a) ?? 0) - (closeTime(b) ?? 0))
  const days = dailyTotals(closed)
  const winningDays = days.filter((d) => d.pnl > 0)
  const losingDays = days.filter((d) => d.pnl < 0)

  const holdAll = closed.map(holdMinutes).filter((m) => m !== null)
  const holdWins = wins.map(holdMinutes).filter((m) => m !== null)
  const holdLosses = losses.map(holdMinutes).filter((m) => m !== null)

  const dd = maxDrawdown(closed)

  return {
    // Headline
    totalPnl,
    winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
    profitFactor,
    profitFactorLabel: profitFactorLabel(profitFactor),
    expectancy: closed.length ? totalPnl / closed.length : 0,

    // Counts
    tradeCount: closed.length,
    winCount: wins.length,
    lossCount: losses.length,
    breakEvenCount: breakEven.length,
    openCount: allTrades.filter(isOpen).length,

    // Trade-level
    grossProfit,
    grossLoss,
    avgWin,
    avgLoss,
    bestTrade: pnls.length ? Math.max(...pnls) : 0,
    worstTrade: pnls.length ? Math.min(...pnls) : 0,
    // Reward per 1 unit of risk, from realised averages.
    riskReward: avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0,
    winStreak: longestStreak(chronological, (t) => net(t) > 0),
    lossStreak: longestStreak(chronological, (t) => net(t) < 0),
    totalCommission: closed.reduce((s, t) => s + (Number(t.fees) || 0), 0),
    totalSwap: closed.reduce((s, t) => s + (Number(t.swap) || 0), 0),
    avgHoldMinutes: avg(holdAll),
    avgHoldMinutesWinners: avg(holdWins),
    avgHoldMinutesLosers: avg(holdLosses),

    // Day-level
    tradingDays: days.length,
    winningDays: winningDays.length,
    losingDays: losingDays.length,
    breakEvenDays: days.filter((d) => d.pnl === 0).length,
    maxConsecutiveWinningDays: longestStreak(days, (d) => d.pnl > 0),
    maxConsecutiveLosingDays: longestStreak(days, (d) => d.pnl < 0),
    avgDailyPnl: days.length ? totalPnl / days.length : 0,
    avgWinningDayPnl: avg(winningDays.map((d) => d.pnl)),
    avgLosingDayPnl: avg(losingDays.map((d) => d.pnl)),
    largestProfitableDay: days.length ? Math.max(...days.map((d) => d.pnl)) : 0,
    largestLosingDay: days.length ? Math.min(...days.map((d) => d.pnl)) : 0,
    avgDailyVolume: days.length ? closed.length / days.length : 0,
    maxDrawdown: dd.amount,
    maxDrawdownPct: dd.pct,

    // Series for charts
    days,
  }
}

// Formats a minute count the way the spec's stat grid shows it ("30m", "2h 5m").
export function fmtDuration(minutes) {
  if (!minutes || !Number.isFinite(minutes)) return '—'
  const total = Math.round(minutes)
  if (total < 60) return `${total}m`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

// ---------------------------------------------------------------------------
// Breakdowns
// ---------------------------------------------------------------------------

// Non-overlapping UTC sessions covering all 24 hours, so every trade lands in
// exactly one bucket. Deliberately different from `sessions.js`'s four
// overlapping city sessions — see the note at the top of that file.
export const TRADING_SESSIONS = [
  { id: 'asian', label: 'Asian', start: 22, end: 8, tint: 'var(--info)' },
  { id: 'london', label: 'London', start: 8, end: 13, tint: 'var(--mint)' },
  { id: 'newyork', label: 'New York', start: 13, end: 22, tint: 'var(--amber)' },
]

/** Which session a trade closed in, or null when it carries no usable time. */
export function sessionOf(trade) {
  const at = closeTime(trade)
  if (at === null) return null
  const hour = new Date(at).getUTCHours()
  return TRADING_SESSIONS.find((s) => (
    s.start < s.end ? hour >= s.start && hour < s.end : hour >= s.start || hour < s.end
  ))?.id ?? null
}

/** Aggregate stats for one bag of trades — the shape every breakdown returns. */
function group(trades) {
  const wins = trades.filter((t) => net(t) > 0)
  const losses = trades.filter((t) => net(t) < 0)
  const pnl = trades.reduce((s, t) => s + net(t), 0)
  const grossLoss = losses.reduce((s, t) => s + net(t), 0)
  return {
    count: trades.length,
    pnl,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    avg: trades.length ? pnl / trades.length : 0,
    profitFactor: grossLoss !== 0
      ? wins.reduce((s, t) => s + net(t), 0) / Math.abs(grossLoss)
      : wins.length ? Infinity : 0,
  }
}

export function bySession(trades) {
  return TRADING_SESSIONS.map((s) => ({
    ...s,
    ...group(trades.filter((t) => sessionOf(t) === s.id)),
  }))
}

// The schema writes `side` as 'Long'/'Short'; the MT5 bridge and some imports
// use `direction` as 'buy'/'sell'. Both mean the same thing, so both are read
// rather than making one of them silently vanish from this breakdown.
export function directionOf(trade) {
  const raw = String(trade.side || trade.direction || '').trim().toLowerCase()
  if (raw === 'long' || raw === 'buy') return 'long'
  if (raw === 'short' || raw === 'sell') return 'short'
  return null
}

export function byDirection(trades) {
  return [
    { id: 'long', label: 'Long', ...group(trades.filter((t) => directionOf(t) === 'long')) },
    { id: 'short', label: 'Short', ...group(trades.filter((t) => directionOf(t) === 'short')) },
  ]
}

// Monday-first, matching the calendar heatmap and the Monday-based week used
// everywhere else in the app.
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function byDayOfWeek(trades) {
  const buckets = WEEKDAYS.map((label) => ({ label, trades: [] }))
  for (const t of trades) {
    const at = closeTime(t)
    if (at === null) continue
    // getDay: Sunday 0 … Saturday 6 → Monday 0 … Sunday 6.
    buckets[(new Date(at).getDay() + 6) % 7].trades.push(t)
  }
  return buckets.map((b) => ({ label: b.label, ...group(b.trades) }))
}

export function bySymbol(trades, limit = 8) {
  const map = new Map()
  for (const t of trades) {
    const key = (t.symbol || 'Unknown').toUpperCase()
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(t)
  }
  return [...map.entries()]
    .map(([symbol, list]) => ({ symbol, ...group(list) }))
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, limit)
}

/**
 * P&L histogram. Bucket edges are derived from the data rather than fixed:
 * a $50 bucket is meaningless to someone trading $5 positions and useless to
 * someone trading $5,000 ones.
 */
export function winLossDistribution(trades, bucketCount = 8) {
  const pnls = trades.map(net).filter(Number.isFinite)
  if (!pnls.length) return []

  const max = Math.max(...pnls.map(Math.abs))
  if (max === 0) return [{ label: '$0', from: 0, to: 0, count: pnls.length, positive: true }]

  // Symmetric around zero, so wins and losses are visually comparable rather
  // than each scaled to their own extreme.
  const half = Math.ceil(bucketCount / 2)
  const step = max / half
  const buckets = []
  for (let i = -half; i < half; i++) {
    const from = i * step
    const to = (i + 1) * step
    buckets.push({
      from, to, positive: from >= 0,
      // Only the lower edge is labelled. Eight full "-$393…-$294" ranges do
      // not fit across a half-width panel — they collide into an unreadable
      // smear — so the axis carries the edge and the tooltip carries the range.
      label: fmtBucket(from),
      range: `${fmtBucket(from)} to ${fmtBucket(to)}`,
      // The topmost bucket is closed at the end so the single largest win
      // isn't dropped by an exclusive upper bound.
      count: pnls.filter((p) => p >= from && (i === half - 1 ? p <= to : p < to)).length,
    })
  }
  return buckets
}

function fmtBucket(n) {
  const rounded = Math.round(n)
  return `${rounded < 0 ? '-' : ''}$${Math.abs(rounded)}`
}

// ---------------------------------------------------------------------------
// Trading calendar
// ---------------------------------------------------------------------------

/**
 * A month laid out as Monday-first weeks, each carrying its own rollup — the
 * spec's eighth column.
 *
 * Days outside the month are included as padding so the grid stays rectangular,
 * flagged with `outside` so they can be dimmed rather than looking like real
 * days with no trades.
 */
export function calendarMonth(trades, year, month) {
  const totals = new Map(dailyTotals(trades).map((d) => [d.date, d]))

  const first = new Date(year, month, 1)
  const start = new Date(first)
  start.setDate(1 - ((first.getDay() + 6) % 7)) // back to Monday

  const weeks = []
  const cursor = new Date(start)
  // Six rows covers every possible month layout; trailing all-outside weeks
  // are dropped below so short months don't render an empty final row.
  for (let w = 0; w < 6; w++) {
    const days = []
    for (let d = 0; d < 7; d++) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
      const total = totals.get(key)
      days.push({
        key,
        date: new Date(cursor),
        day: cursor.getDate(),
        outside: cursor.getMonth() !== month,
        pnl: total?.pnl ?? 0,
        count: total?.count ?? 0,
        wins: total?.wins ?? 0,
        trades: total?.trades ?? [],
      })
      cursor.setDate(cursor.getDate() + 1)
    }
    const inMonth = days.filter((d) => !d.outside)
    weeks.push({
      days,
      // The rollup counts only days belonging to this month, so a week
      // straddling a boundary isn't double-counted in both months.
      pnl: inMonth.reduce((s, d) => s + d.pnl, 0),
      count: inMonth.reduce((s, d) => s + d.count, 0),
      tradingDays: inMonth.filter((d) => d.count > 0).length,
    })
  }
  while (weeks.length && weeks[weeks.length - 1].days.every((d) => d.outside)) weeks.pop()
  return weeks
}

/** Largest absolute daily P&L in a month — the heatmap's colour scale. */
export function calendarScale(weeks) {
  const values = weeks.flatMap((w) => w.days.filter((d) => !d.outside && d.count).map((d) => Math.abs(d.pnl)))
  return values.length ? Math.max(...values) : 0
}
