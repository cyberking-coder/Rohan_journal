// Backtesting: candle parsing and the order simulation engine.
//
// Pure functions, no React, no I/O — the whole point is that the rules
// governing a fill are testable in isolation. A backtester that silently fills
// optimistically is worse than no backtester at all: it manufactures
// confidence, and the user acts on it with real money.
//
// ── On where candles come from ─────────────────────────────────────────────
// No market data vendor is bundled, for the same reason no calendar feed was:
// licensing differs, and redistributing price history is often the one thing
// a data agreement forbids. But unlike the calendar, this needs no vendor at
// all in the common case — MetaTrader, TradingView and most brokers export
// candle history as CSV, and `parseCandles` reads it. `ADAPTERS` is there for
// anyone who does want to wire a live API.

import { contractSizeFor, computePnl } from './instruments.js'

// ---------------------------------------------------------------------------
// Candles
// ---------------------------------------------------------------------------

export const TIMEFRAMES = {
  M1: { label: 'M1', minutes: 1 },
  M5: { label: 'M5', minutes: 5 },
  M15: { label: 'M15', minutes: 15 },
  M30: { label: 'M30', minutes: 30 },
  H1: { label: 'H1', minutes: 60 },
  H4: { label: 'H4', minutes: 240 },
  D1: { label: 'D1', minutes: 1440 },
}

// `date` and `time` map to separate keys on purpose: MetaTrader splits them
// across two columns, and folding both onto one key means the second silently
// overwrites the first — every candle in a day collapsing onto midnight.
const HEADER_ALIASES = {
  time: 'time', datetime: 'time', timestamp: 'time', t: 'time',
  date: 'date',
  open: 'open', o: 'open',
  high: 'high', h: 'high',
  low: 'low', l: 'low',
  close: 'close', c: 'close', 'adj close': 'close',
  volume: 'volume', vol: 'volume', v: 'volume', tickvol: 'volume',
}

/**
 * Reads candles from CSV or JSON.
 *
 * MetaTrader exports tab-separated with a `<DATE>\t<TIME>` pair; TradingView
 * exports comma-separated with an ISO timestamp; a hand-rolled JSON export is
 * a list of objects. All three arrive here, so the parser sniffs rather than
 * demanding one shape.
 */
export function parseCandles(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) throw new Error('The file is empty.')

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return fromJson(trimmed)
  return fromDelimited(trimmed)
}

function fromJson(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('That looks like JSON but could not be parsed.')
  }
  const rows = Array.isArray(data) ? data : (data.candles || data.bars || data.data)
  if (!Array.isArray(rows)) throw new Error('Expected a list of candles.')
  return normalizeAll(rows.map((r) => (Array.isArray(r) ? arrayRow(r) : lowerKeys(r))))
}

// An OHLC row given as a bare array is conventionally [time, o, h, l, c, v].
function arrayRow(r) {
  return { time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }
}

function lowerKeys(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = HEADER_ALIASES[String(k).toLowerCase().replace(/[<>]/g, '').trim()]
    if (key) out[key] = v
  }
  return out
}

function fromDelimited(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  // Tab first: MetaTrader uses tabs, and a CSV never contains one.
  const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ','

  const first = splitRow(lines[0], delim)
  const looksLikeHeader = first.some((cell) => /[a-z]/i.test(cell) && !/^\d{4}[-./]/.test(cell))
  const headers = looksLikeHeader
    ? first.map((h) => HEADER_ALIASES[h.toLowerCase().replace(/[<>"]/g, '').trim()] || null)
    // Headerless files are assumed to be time,o,h,l,c,v — the near-universal
    // column order for exported candles.
    : ['time', 'open', 'high', 'low', 'close', 'volume']

  if (!headers.includes('close')) {
    throw new Error('Could not find OHLC columns. Expected headers like time, open, high, low, close.')
  }

  const rows = (looksLikeHeader ? lines.slice(1) : lines).map((line) => {
    const cells = splitRow(line, delim)
    const row = {}
    headers.forEach((h, i) => { if (h) row[h] = cells[i] })
    return row
  })

  return normalizeAll(rows)
}

function splitRow(line, delim) {
  return line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''))
}

function normalizeAll(rows) {
  const candles = []
  let skipped = 0

  for (const row of rows) {
    const c = normalizeCandle(row)
    if (c) candles.push(c)
    else skipped++
  }

  if (!candles.length) throw new Error('No usable candles found in that file.')

  candles.sort((a, b) => a.t - b.t)

  // Duplicate timestamps mean the file was concatenated or double-exported.
  // Replaying them would show the same bar twice and let a stop trigger on a
  // bar that never existed.
  const deduped = []
  for (const c of candles) {
    if (deduped.length && deduped[deduped.length - 1].t === c.t) continue
    deduped.push(c)
  }

  return { candles: deduped, skipped, duplicates: candles.length - deduped.length }
}

function normalizeCandle(row) {
  // A file carrying date and time separately (MetaTrader) needs them joined
  // before parsing; one carrying a single timestamp just uses it.
  const stamp = row.date && row.time ? `${row.date} ${row.time}` : (row.time ?? row.date)
  const t = parseTime(stamp)
  const o = Number(row.open)
  const h = Number(row.high)
  const l = Number(row.low)
  const c = Number(row.close)

  if (t === null) return null
  if (![o, h, l, c].every((n) => Number.isFinite(n) && n > 0)) return null
  // A candle whose high is below its open, or low above its close, is corrupt.
  // Replaying it would produce fills at prices that never traded.
  if (h < Math.max(o, c) || l > Math.min(o, c) || h < l) return null

  return { t, o, h, l, c, v: Number(row.volume) || 0 }
}

function parseTime(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number') return value > 1e11 ? value : value * 1000

  const text = String(value).trim()
  if (/^\d+$/.test(text)) {
    const n = Number(text)
    return n > 1e11 ? n : n * 1000
  }
  // MetaTrader writes the date as 2026.08.13; ISO uses dashes. Only the date
  // portion is rewritten — replacing every dot also eats the decimal point in
  // an ISO timestamp's milliseconds ("09:00:00.000Z" → "09:00:00-000Z"),
  // which makes the whole string unparseable and silently drops every candle
  // from an ordinary ISO export.
  const iso = text.replace(/^(\d{4})\.(\d{2})\.(\d{2})/, '$1-$2-$3').replace(' ', 'T')
  const ms = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  return Number.isFinite(ms) ? ms : null
}

/** Guessed bar interval, used to label an imported file. */
export function detectTimeframe(candles) {
  if (candles.length < 3) return null
  const gaps = []
  for (let i = 1; i < Math.min(candles.length, 60); i++) gaps.push(candles[i].t - candles[i - 1].t)
  gaps.sort((a, b) => a - b)
  // Median, not mean: weekend gaps are enormous and would drag an average
  // into nonsense.
  const median = gaps[Math.floor(gaps.length / 2)] / 60000
  const match = Object.entries(TIMEFRAMES).find(([, tf]) => Math.abs(tf.minutes - median) < tf.minutes * 0.2)
  return match ? match[0] : null
}

// A seam for anyone wiring a live OHLC API. Same shape as the calendar
// importer's: a function returning raw rows, which `parseCandles` normalises.
export const ADAPTERS = {}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export const SIDES = ['Long', 'Short']

/**
 * Validates an order against the current price.
 *
 * Returns a list of problems rather than throwing, so the ticket can show all
 * of them at once instead of one per attempt.
 */
export function validateOrder({ side, lots, entry, stopLoss, takeProfit }) {
  const problems = []
  const l = Number(lots)
  const e = Number(entry)
  const sl = stopLoss === '' || stopLoss === null || stopLoss === undefined ? null : Number(stopLoss)
  const tp = takeProfit === '' || takeProfit === null || takeProfit === undefined ? null : Number(takeProfit)

  if (!SIDES.includes(side)) problems.push('Pick a direction.')
  if (!Number.isFinite(l) || l <= 0) problems.push('Lot size must be greater than zero.')
  if (!Number.isFinite(e) || e <= 0) problems.push('No entry price.')

  // A stop on the wrong side of entry isn't a stop — it's an instant fill at a
  // price the trader didn't intend, and the engine would close the position on
  // the very next candle.
  if (sl !== null) {
    if (!Number.isFinite(sl) || sl <= 0) problems.push('Stop loss is not a price.')
    else if (side === 'Long' && sl >= e) problems.push('A long’s stop must be below entry.')
    else if (side === 'Short' && sl <= e) problems.push('A short’s stop must be above entry.')
  }
  if (tp !== null) {
    if (!Number.isFinite(tp) || tp <= 0) problems.push('Take profit is not a price.')
    else if (side === 'Long' && tp <= e) problems.push('A long’s target must be above entry.')
    else if (side === 'Short' && tp >= e) problems.push('A short’s target must be below entry.')
  }

  return problems
}

/**
 * Decides whether an open position closes on this candle.
 *
 * ── The ambiguity that makes or breaks a backtest ──────────────────────────
 * When a candle's range contains BOTH the stop and the target, OHLC data
 * cannot say which was touched first — that information only exists in the
 * ticks inside the bar, which the file doesn't carry.
 *
 * Assuming the target is the single most common way a backtest flatters
 * itself: every ambiguous bar becomes a win, and a losing strategy reads as
 * profitable. So this resolves ambiguity to the STOP — the pessimistic
 * reading — and marks the trade `ambiguous` so the results panel can say how
 * many fills were decided this way. A strategy that only works when you
 * assume the good outcome is not a strategy.
 *
 * The one case that is not ambiguous: a gap. If the candle opens beyond a
 * level, that level filled at the open, at the opening price — not at the
 * level, because the price was never there.
 */
export function resolveExit(position, candle) {
  const { side, stopLoss: sl, takeProfit: tp } = position
  const long = side === 'Long'

  const hitSl = sl !== null && sl !== undefined && (long ? candle.l <= sl : candle.h >= sl)
  const hitTp = tp !== null && tp !== undefined && (long ? candle.h >= tp : candle.l <= tp)

  if (!hitSl && !hitTp) return null

  // Gapped through on the open: the fill is the open, not the level.
  const gappedSl = hitSl && (long ? candle.o <= sl : candle.o >= sl)
  const gappedTp = hitTp && (long ? candle.o >= tp : candle.o <= tp)

  if (gappedSl && gappedTp) {
    // Opened beyond both — take the pessimistic one, consistent with below.
    return { price: candle.o, reason: 'stop', gapped: true, ambiguous: true, at: candle.t }
  }
  if (gappedSl) return { price: candle.o, reason: 'stop', gapped: true, ambiguous: false, at: candle.t }
  if (gappedTp) return { price: candle.o, reason: 'target', gapped: true, ambiguous: false, at: candle.t }

  if (hitSl && hitTp) return { price: sl, reason: 'stop', gapped: false, ambiguous: true, at: candle.t }
  if (hitSl) return { price: sl, reason: 'stop', gapped: false, ambiguous: false, at: candle.t }
  return { price: tp, reason: 'target', gapped: false, ambiguous: false, at: candle.t }
}

/** Money P&L for a position at a given price. */
export function positionPnl(position, price) {
  return computePnl({
    entry: position.entry,
    exit: price,
    lots: position.lots,
    side: position.side,
    contractSize: position.contractSize ?? contractSizeFor(position.symbol),
  }) ?? 0
}

export function openPosition({ symbol, side, lots, entry, stopLoss, takeProfit, at, note }) {
  return {
    id: `bt-${at}-${Math.round(entry * 1e6)}-${side}`,
    symbol, side,
    lots: Number(lots),
    entry: Number(entry),
    stopLoss: stopLoss === '' || stopLoss === null || stopLoss === undefined ? null : Number(stopLoss),
    takeProfit: takeProfit === '' || takeProfit === null || takeProfit === undefined ? null : Number(takeProfit),
    contractSize: contractSizeFor(symbol),
    openedAt: at,
    note: note || '',
  }
}

export function closePosition(position, { price, at, reason }) {
  return {
    ...position,
    exit: price,
    closedAt: at,
    reason,
    pnl: positionPnl(position, price),
  }
}

/**
 * Advances the simulation by one candle.
 *
 * Returns the new open list and anything that closed, rather than mutating —
 * the replay can be stepped backwards by replaying from the start, which is
 * only sound if each step is a pure function of the one before it.
 */
export function step(open, candle) {
  const stillOpen = []
  const closed = []

  for (const position of open) {
    // A position can't be stopped out by the candle it was opened on — it was
    // opened at that candle's close, so the bar's high and low already
    // happened. Filling it here would close trades on prices from the past.
    if (position.openedAt >= candle.t) {
      stillOpen.push(position)
      continue
    }
    const exit = resolveExit(position, candle)
    if (exit) {
      closed.push({ ...closePosition(position, { price: exit.price, at: exit.at, reason: exit.reason }), ambiguous: exit.ambiguous, gapped: exit.gapped })
    } else {
      stillOpen.push(position)
    }
  }

  return { open: stillOpen, closed }
}

/** Unrealised P&L of everything still open, marked at the given price. */
export function floatingPnl(open, price) {
  return open.reduce((sum, p) => sum + positionPnl(p, price), 0)
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Maps simulated trades onto the shape `computeAnalytics` expects, so a
 * backtest is scored by exactly the same engine as real trades.
 *
 * Reusing it rather than writing a second scorer is the point: two
 * implementations of "win rate" eventually disagree, and then nobody knows
 * which page to believe.
 */
export function toTradeRows(closed) {
  return closed.map((t) => ({
    id: t.id,
    symbol: t.symbol,
    side: t.side,
    pnl: t.pnl,
    fees: 0,
    swap: 0,
    opened_at: new Date(t.openedAt).toISOString(),
    traded_at: new Date(t.closedAt).toISOString(),
    closed_at: new Date(t.closedAt).toISOString(),
  }))
}

/** How much of the result rests on a coin-flip the data can't settle. */
export function ambiguityReport(closed) {
  const ambiguous = closed.filter((t) => t.ambiguous)
  return {
    count: ambiguous.length,
    total: closed.length,
    pct: closed.length ? (ambiguous.length / closed.length) * 100 : 0,
    // What the result would have been under the optimistic reading, as the
    // honest way to show the size of the uncertainty rather than hiding it.
    swing: ambiguous.reduce((sum, t) => {
      if (t.takeProfit === null || t.takeProfit === undefined) return sum
      return sum + (positionPnl(t, t.takeProfit) - t.pnl)
    }, 0),
  }
}
