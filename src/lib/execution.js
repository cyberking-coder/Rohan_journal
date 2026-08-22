// Execution costs for the backtester — Master PRD §53.
//
// A backtest without costs is not a pessimistic estimate of a strategy, it is
// a different strategy. Spread alone turns a scalping edge into a loss, and it
// does so silently: every number still looks reasonable, just better than any
// of them will ever be live.
//
// ── What this models ───────────────────────────────────────────────────────
//   spread     — paid once per round trip
//   commission — per lot, round turn
//   slippage   — adverse, on market entries and stop fills
//   swap       — per night held, tripled on the Wednesday rollover
//
// ── What it does NOT model, and should not be read as modelling ────────────
//   • Variable spread. Real spread widens at the open, into news, and at
//     rollover — exactly when stops get hit. A fixed figure understates the
//     cost of the trades that hurt most.
//   • Partial fills, requotes, or rejection.
//   • Slippage as a distribution. It is applied as a constant, which is the
//     honest simplification: a random draw would make results irreproducible
//     and no more accurate.
//   • The bid/ask asymmetry in stop *triggering*. Levels are compared against
//     the candle as given; only the fill price is adjusted.
//
// The candles are assumed to be BID prices, which is what MT5 exports. So a
// long buys at bid+spread and sells at bid; a short sells at bid and buys back
// at bid+spread. Either way the spread is paid exactly once, which is the
// property that matters.

import { getInstrument } from './pips.js'
import { computePnl, contractSizeFor } from './instruments.js'

// Presets, in the units a broker quotes them.
//
// These are plausible retail figures, not quotes from any particular broker,
// and the UI says so. The point of a preset is to stop the default being zero,
// which is the one value guaranteed to be wrong.
export const COST_PRESETS = {
  none: {
    label: 'None',
    hint: 'No costs at all. Useful for isolating whether a rule works, useless for deciding whether to trade it.',
    spreadPips: 0, commissionPerLot: 0, slippagePips: 0, swapLongPerLot: 0, swapShortPerLot: 0,
  },
  raw: {
    label: 'Raw / ECN',
    hint: 'Tight spread, commission charged separately. Typical of a raw-spread account.',
    spreadPips: 0.2, commissionPerLot: 7, slippagePips: 0.2, swapLongPerLot: -7, swapShortPerLot: 2,
  },
  standard: {
    label: 'Standard',
    hint: 'Spread-only account: no commission, wider spread.',
    spreadPips: 1.2, commissionPerLot: 0, slippagePips: 0.3, swapLongPerLot: -8, swapShortPerLot: 1,
  },
  wide: {
    label: 'Stress test',
    hint: 'Deliberately harsh. If the strategy survives this, the costs aren’t what will kill it.',
    spreadPips: 2.5, commissionPerLot: 10, slippagePips: 1, swapLongPerLot: -12, swapShortPerLot: -4,
  },
}

export const DEFAULT_PRESET = 'standard'

export function normaliseCosts(raw) {
  const base = COST_PRESETS[raw?.preset] || COST_PRESETS[DEFAULT_PRESET]
  const c = { ...base, ...(raw || {}) }
  return {
    preset: COST_PRESETS[raw?.preset] ? raw.preset : (raw?.preset === 'custom' ? 'custom' : DEFAULT_PRESET),
    // Costs cannot be negative — a negative spread would pay the trader to
    // trade, and is always a typo rather than a broker.
    spreadPips: nonNegative(c.spreadPips),
    commissionPerLot: nonNegative(c.commissionPerLot),
    slippagePips: nonNegative(c.slippagePips),
    // Swap genuinely can be either sign: one side of a carry pair pays.
    swapLongPerLot: finite(c.swapLongPerLot),
    swapShortPerLot: finite(c.swapShortPerLot),
  }
}

function nonNegative(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}
function finite(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function pipSizeFor(symbol) {
  return getInstrument(symbol)?.pipSize ?? 0.0001
}

// ---------------------------------------------------------------------------
// Fills
// ---------------------------------------------------------------------------

/**
 * The price actually paid to open.
 *
 * Slippage on entry applies to market orders only. A limit order that fills
 * does so at its price or better, so charging it slippage would be inventing a
 * cost the trader does not pay.
 */
export function entryFill({ side, price, costs, symbol, kind = 'market' }) {
  const c = normaliseCosts(costs)
  const pip = pipSizeFor(symbol)
  const spread = c.spreadPips * pip
  const slip = kind === 'limit' ? 0 : c.slippagePips * pip

  return side === 'Long' ? price + spread + slip : price - slip
}

/**
 * The price actually received on close.
 *
 * A stop is a market order once triggered, so it slips. A take-profit is a
 * limit and does not. Getting this backwards — slipping the target too — makes
 * costs symmetric, which feels fair and is wrong: the asymmetry is precisely
 * why real results trail backtested ones.
 */
export function exitFill({ side, price, costs, symbol, reason = 'manual' }) {
  const c = normaliseCosts(costs)
  const pip = pipSizeFor(symbol)
  const spread = c.spreadPips * pip
  const slips = reason !== 'target'
  const slip = slips ? c.slippagePips * pip : 0

  // The spread lands on the closing side of a short, having been avoided on
  // its entry — paid once per round trip either way.
  return side === 'Long' ? price - slip : price + spread + slip
}

// ---------------------------------------------------------------------------
// Swap
// ---------------------------------------------------------------------------

/**
 * How many rollovers a position was held through.
 *
 * Counted as UTC date boundaries crossed. Brokers roll at 22:00 or 00:00
 * server time depending on the broker, and the difference is at most one
 * charge on a multi-day hold — not worth a configuration field that most users
 * would get wrong.
 *
 * Wednesday counts triple: the market settles T+2, and Saturday and Sunday
 * are not settlement days, so Wednesday's rollover carries the weekend. A
 * trader holding swing positions sees this on their statement and would
 * notice its absence here.
 */
export function rollovers(openedAt, closedAt) {
  if (!Number.isFinite(openedAt) || !Number.isFinite(closedAt)) return 0
  const start = Math.floor(openedAt / 86400000)
  const end = Math.floor(closedAt / 86400000)
  if (end <= start) return 0

  let total = 0
  for (let day = start; day < end; day++) {
    // The charge lands at the end of `day`, so it is that day's weekday that
    // decides whether it is tripled. 1970-01-01 was a Thursday.
    const weekday = (day + 4) % 7  // 0 = Sunday
    total += weekday === 3 ? 3 : 1
  }
  return total
}

export function swapCharge({ side, lots, openedAt, closedAt, costs }) {
  const c = normaliseCosts(costs)
  const nights = rollovers(openedAt, closedAt)
  if (!nights) return 0
  const perLot = side === 'Long' ? c.swapLongPerLot : c.swapShortPerLot
  return perLot * nights * (Number(lots) || 0)
}

// ---------------------------------------------------------------------------
// The full accounting
// ---------------------------------------------------------------------------

/**
 * What a trade actually made, and where the difference went.
 *
 * The breakdown is the point. "Your backtest made $4,000 instead of $6,200" is
 * an unhelpful thing to be told; "$1,400 of that was spread and $800 was
 * commission" tells the trader whether to trade less often or find a cheaper
 * broker.
 *
 * @param position  { symbol, side, lots, entry, contractSize }
 * @param exitPrice the raw price from the candle, before costs
 */
export function costedResult(position, exitPrice, costs, { reason = 'manual', closedAt = null } = {}) {
  const c = normaliseCosts(costs)
  const { symbol, side, lots } = position
  const contractSize = position.contractSize ?? contractSizeFor(symbol)

  const money = (from, to) => computePnl({
    entry: from, exit: to, lots, side, contractSize,
  }) ?? 0

  // Gross is what the strategy would have made at the raw prices — the figure
  // a costless backtest reports, kept so the difference is visible.
  const gross = money(position.entry, exitPrice)

  const filledEntry = entryFill({ side, price: position.entry, costs: c, symbol, kind: position.entryKind })
  const filledExit = exitFill({ side, price: exitPrice, costs: c, symbol, reason })
  const afterPrices = money(filledEntry, filledExit)

  // Attributed by re-pricing one leg at a time, so the parts add up to the
  // whole exactly rather than approximately.
  const noSlip = { ...c, slippagePips: 0 }
  const noSpread = { ...c, spreadPips: 0 }
  const afterSpreadOnly = money(
    entryFill({ side, price: position.entry, costs: noSlip, symbol, kind: position.entryKind }),
    exitFill({ side, price: exitPrice, costs: noSlip, symbol, reason }),
  )
  const afterSlipOnly = money(
    entryFill({ side, price: position.entry, costs: noSpread, symbol, kind: position.entryKind }),
    exitFill({ side, price: exitPrice, costs: noSpread, symbol, reason }),
  )

  const spreadCost = gross - afterSpreadOnly
  const slippageCost = gross - afterSlipOnly
  // Whatever the two legs cost together that the parts don't explain — zero
  // for a linear P&L, non-zero if an instrument's maths ever isn't. Carrying
  // it explicitly means the breakdown always reconciles.
  const interaction = (gross - afterPrices) - spreadCost - slippageCost

  const commission = c.commissionPerLot * (Number(lots) || 0)
  const swap = swapCharge({
    side, lots, openedAt: position.openedAt, closedAt, costs: c,
  })

  const net = afterPrices - commission + swap

  return {
    gross,
    net,
    spreadCost,
    slippageCost,
    interaction,
    commission,
    // Positive is a credit, negative a charge — the sign convention on a
    // broker statement, so it can be compared against one.
    swap,
    totalCost: gross - net,
    filledEntry,
    filledExit,
    nights: rollovers(position.openedAt, closedAt),
  }
}

/** Sums the breakdowns of many trades, for the results panel. */
export function costSummary(results) {
  const zero = {
    gross: 0, net: 0, spreadCost: 0, slippageCost: 0, interaction: 0,
    commission: 0, swap: 0, totalCost: 0, trades: 0,
  }
  const out = (results || []).reduce((a, r) => {
    if (!r) return a
    return {
      gross: a.gross + (r.gross || 0),
      net: a.net + (r.net || 0),
      spreadCost: a.spreadCost + (r.spreadCost || 0),
      slippageCost: a.slippageCost + (r.slippageCost || 0),
      interaction: a.interaction + (r.interaction || 0),
      commission: a.commission + (r.commission || 0),
      swap: a.swap + (r.swap || 0),
      totalCost: a.totalCost + (r.totalCost || 0),
      trades: a.trades + 1,
    }
  }, zero)

  return {
    ...out,
    // The headline: what share of the gross edge the costs ate. Undefined
    // rather than 0 when there was no gross profit to eat, because "costs took
    // 0%" of a losing strategy is a meaningless reassurance.
    costShare: out.gross > 0 ? (out.totalCost / out.gross) * 100 : null,
    // The other headline, and often the more alarming one.
    flipped: out.gross > 0 && out.net <= 0,
  }
}
