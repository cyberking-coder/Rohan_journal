// Execution costs.
//
// The properties that matter are structural rather than numeric: the spread is
// paid exactly once per round trip whichever way the trade went, costs always
// hurt and never help, targets don't slip while stops do, and the breakdown
// reconciles to the net exactly.

import assert from 'node:assert/strict'
import {
  COST_PRESETS, costSummary, costedResult, entryFill, exitFill,
  normaliseCosts, pipSizeFor, rollovers, swapCharge,
} from '../src/lib/execution.js'

let checks = 0
function ok(c, m) { assert.ok(c, m); checks++ }
function eq(a, b, m) { assert.deepEqual(a, b, m); checks++ }
function near(a, b, m, tol = 1e-6) { assert.ok(Math.abs(a - b) < tol, `${m}: ${a} vs ${b}`); checks++ }

const FREE = { preset: 'none' }
// One pip of EURUSD is 0.0001; one lot is 100,000 units, so a pip is $10.
const SPREAD1 = { preset: 'custom', spreadPips: 1, commissionPerLot: 0, slippagePips: 0, swapLongPerLot: 0, swapShortPerLot: 0 }

// ── normalisation ──────────────────────────────────────────────────────────
{
  const d = normaliseCosts(null)
  eq(d.preset, 'standard', 'defaults to the standard preset')
  ok(d.spreadPips > 0, 'and the default is not free')

  eq(normaliseCosts({ preset: 'none' }).spreadPips, 0, 'none really is none')
  eq(normaliseCosts({ preset: 'nonsense' }).preset, 'standard', 'unknown preset falls back')

  // Negative costs are always a typo.
  eq(normaliseCosts({ preset: 'custom', spreadPips: -3 }).spreadPips, 0, 'negative spread clamped')
  eq(normaliseCosts({ preset: 'custom', commissionPerLot: -5 }).commissionPerLot, 0, 'negative commission clamped')
  eq(normaliseCosts({ preset: 'custom', slippagePips: 'abc' }).slippagePips, 0, 'unparseable slippage is zero')

  // Swap is genuinely signed: one side of a carry pair is paid.
  eq(normaliseCosts({ preset: 'custom', swapLongPerLot: -8 }).swapLongPerLot, -8, 'negative swap survives')
  eq(normaliseCosts({ preset: 'custom', swapShortPerLot: 3 }).swapShortPerLot, 3, 'positive swap survives')

  near(pipSizeFor('EURUSD'), 0.0001, 'EURUSD pip')
  near(pipSizeFor('USDJPY'), 0.01, 'JPY pip')
  near(pipSizeFor('XAUUSD'), 0.1, 'gold pip')
  near(pipSizeFor('WHAT'), 0.0001, 'an unknown symbol falls back rather than throwing')
}

// ── fills ──────────────────────────────────────────────────────────────────
{
  const s = { costs: SPREAD1, symbol: 'EURUSD' }

  // Bid candles: a long buys the ask, sells the bid.
  near(entryFill({ ...s, side: 'Long', price: 1.1 }), 1.1001, 'long pays the spread on entry')
  near(exitFill({ ...s, side: 'Long', price: 1.1 }), 1.1, 'and not again on exit')
  // A short sells the bid, buys back the ask.
  near(entryFill({ ...s, side: 'Short', price: 1.1 }), 1.1, 'short pays nothing on entry')
  near(exitFill({ ...s, side: 'Short', price: 1.1 }), 1.1001, 'and the spread on exit')

  // Free costs must not move the price at all.
  const f = { costs: FREE, symbol: 'EURUSD' }
  near(entryFill({ ...f, side: 'Long', price: 1.1 }), 1.1, 'no costs, no adjustment')
  near(exitFill({ ...f, side: 'Short', price: 1.1 }), 1.1, 'either side')

  // Slippage: adverse in both directions.
  const slip = { preset: 'custom', spreadPips: 0, slippagePips: 2, commissionPerLot: 0, swapLongPerLot: 0, swapShortPerLot: 0 }
  const sl = { costs: slip, symbol: 'EURUSD' }
  near(entryFill({ ...sl, side: 'Long', price: 1.1 }), 1.1002, 'long slips up on entry')
  near(entryFill({ ...sl, side: 'Short', price: 1.1 }), 1.0998, 'short slips down on entry')
  near(exitFill({ ...sl, side: 'Long', price: 1.1, reason: 'stop' }), 1.0998, 'long stop slips down')
  near(exitFill({ ...sl, side: 'Short', price: 1.1, reason: 'stop' }), 1.1002, 'short stop slips up')

  // The asymmetry that matters: stops slip, limits do not.
  near(exitFill({ ...sl, side: 'Long', price: 1.1, reason: 'target' }), 1.1, 'a target does not slip')
  near(exitFill({ ...sl, side: 'Short', price: 1.1, reason: 'target' }), 1.1, 'either side')
  near(entryFill({ ...sl, side: 'Long', price: 1.1, kind: 'limit' }), 1.1, 'a limit entry does not slip')
}

// ── rollovers ──────────────────────────────────────────────────────────────
{
  // 2026-03-02 is a Monday.
  const mon = Date.parse('2026-03-02T10:00:00Z')
  eq(rollovers(mon, Date.parse('2026-03-02T18:00:00Z')), 0, 'an intraday trade pays no swap')
  eq(rollovers(mon, Date.parse('2026-03-03T09:00:00Z')), 1, 'held overnight, one charge')
  eq(rollovers(mon, Date.parse('2026-03-04T09:00:00Z')), 2, 'two nights')

  // Wednesday carries the weekend at triple. Opening Wednesday and closing
  // Thursday crosses the Wednesday rollover.
  const wed = Date.parse('2026-03-04T10:00:00Z')
  eq(rollovers(wed, Date.parse('2026-03-05T10:00:00Z')), 3, 'the Wednesday rollover is tripled')
  // Mon → Fri crosses Mon, Tue, Wed(×3), Thu = 1+1+3+1
  eq(rollovers(mon, Date.parse('2026-03-06T10:00:00Z')), 6, 'a week including Wednesday')

  eq(rollovers(Date.parse('2026-03-05T10:00:00Z'), mon), 0, 'closing before opening is not negative')
  eq(rollovers(NaN, mon), 0, 'unparseable times charge nothing')

  // Sign convention: a negative rate is a charge, so it reduces P&L.
  const cost = { preset: 'custom', spreadPips: 0, slippagePips: 0, commissionPerLot: 0, swapLongPerLot: -8, swapShortPerLot: 2 }
  near(swapCharge({ side: 'Long', lots: 1, openedAt: mon, closedAt: Date.parse('2026-03-03T09:00:00Z'), costs: cost }),
    -8, 'one night long')
  near(swapCharge({ side: 'Short', lots: 2, openedAt: mon, closedAt: Date.parse('2026-03-03T09:00:00Z'), costs: cost }),
    4, 'a credit, scaled by lots')
  near(swapCharge({ side: 'Long', lots: 1, openedAt: mon, closedAt: Date.parse('2026-03-02T20:00:00Z'), costs: cost }),
    0, 'intraday pays nothing')
}

// ── the full accounting ────────────────────────────────────────────────────
const pos = (over = {}) => ({
  symbol: 'EURUSD', side: 'Long', lots: 1, entry: 1.1000,
  openedAt: Date.parse('2026-03-02T10:00:00Z'), ...over,
})

{
  // 10 pips on one lot of EURUSD = $100.
  const free = costedResult(pos(), 1.1010, FREE, { closedAt: Date.parse('2026-03-02T14:00:00Z') })
  near(free.gross, 100, 'gross with no costs')
  near(free.net, 100, 'net equals gross when nothing is charged')
  near(free.totalCost, 0, 'no cost')

  // One pip of spread on one lot is $10.
  const spread = costedResult(pos(), 1.1010, SPREAD1, { closedAt: Date.parse('2026-03-02T14:00:00Z') })
  near(spread.gross, 100, 'gross is unchanged by costs — that is the point of reporting it')
  near(spread.spreadCost, 10, 'a pip of spread costs a pip')
  near(spread.net, 90, 'and comes off the net')

  // The same spread on a short, same magnitude — paid once either way.
  const short = costedResult(pos({ side: 'Short' }), 1.0990, SPREAD1, { closedAt: Date.parse('2026-03-02T14:00:00Z') })
  near(short.gross, 100, 'a short making the same distance')
  near(short.spreadCost, 10, 'pays the same spread')
  near(short.net, 90, 'and nets the same')
}

{
  // Everything at once, and the breakdown must reconcile exactly.
  const costs = {
    preset: 'custom', spreadPips: 1, slippagePips: 0.5,
    commissionPerLot: 7, swapLongPerLot: -8, swapShortPerLot: 2,
  }
  const r = costedResult(pos({ lots: 2 }), 1.1030, costs, {
    reason: 'stop', closedAt: Date.parse('2026-03-04T14:00:00Z'),
  })

  near(r.gross, 600, '30 pips on two lots')
  near(r.commission, 14, 'commission scales with lots')
  eq(r.nights, 2, 'two nights held')
  near(r.swap, -32, 'charged on both lots for both nights')

  // Reconciliation: this is the property the attribution exists to satisfy.
  near(
    r.net,
    r.gross - r.spreadCost - r.slippageCost - r.interaction - r.commission + r.swap,
    'the breakdown adds back up to the net exactly',
  )
  near(r.totalCost, r.gross - r.net, 'total cost is the whole difference')
  near(r.interaction, 0, 'and there is no unexplained remainder on a linear instrument')

  // Slippage at both legs: 0.5 pip each way is 1 pip, and on two lots $20.
  near(r.slippageCost, 20, 'slippage on entry and on a stop exit')

  // The same trade closing at its target slips only on entry.
  const atTarget = costedResult(pos({ lots: 2 }), 1.1030, costs, {
    reason: 'target', closedAt: Date.parse('2026-03-04T14:00:00Z'),
  })
  near(atTarget.slippageCost, 10, 'a target only slips on the way in — half as much')
  ok(atTarget.net > r.net, 'so hitting the target is worth more than being stopped at the same price')
}

{
  // Costs must never flatter a trade. Checked across both directions and both
  // outcomes, because a sign error typically shows up in exactly one of them.
  for (const side of ['Long', 'Short']) {
    for (const exit of [1.1050, 1.0950]) {
      for (const key of Object.keys(COST_PRESETS)) {
        const p = pos({ side })
        const closedAt = Date.parse('2026-03-04T14:00:00Z')
        const withCosts = costedResult(p, exit, { preset: key }, { reason: 'stop', closedAt })
        const without = costedResult(p, exit, FREE, { reason: 'stop', closedAt })
        // Swap can legitimately be a credit, so compare on the price-and-
        // commission part, which can only ever be a charge.
        const chargeOnly = withCosts.net - withCosts.swap
        ok(chargeOnly <= without.net + 1e-9,
          `${side} ${exit} ${key}: costs never improve a result`)
      }
    }
  }
}

// ── summary ────────────────────────────────────────────────────────────────
{
  const costs = { preset: 'custom', spreadPips: 1, slippagePips: 0, commissionPerLot: 7, swapLongPerLot: 0, swapShortPerLot: 0 }
  const closedAt = Date.parse('2026-03-02T14:00:00Z')
  const results = [
    costedResult(pos(), 1.1010, costs, { closedAt }),   // +100 gross
    costedResult(pos(), 1.1005, costs, { closedAt }),   // +50 gross
  ]
  const s = costSummary(results)

  eq(s.trades, 2, 'both counted')
  near(s.gross, 150, 'gross summed')
  near(s.commission, 14, 'commission summed')
  near(s.spreadCost, 20, 'spread summed')
  near(s.net, 116, 'net summed')
  near(s.costShare, (34 / 150) * 100, 'share of gross eaten by costs')
  eq(s.flipped, false, 'still profitable')

  // The alarming case: gross profit, net loss.
  const heavy = { preset: 'custom', spreadPips: 1, slippagePips: 0, commissionPerLot: 60, swapLongPerLot: 0, swapShortPerLot: 0 }
  const flipped = costSummary([costedResult(pos(), 1.1005, heavy, { closedAt })])
  eq(flipped.flipped, true, 'a strategy whose edge is smaller than its costs is flagged')

  const empty = costSummary([])
  eq(empty.trades, 0, 'empty summary')
  eq(empty.costShare, null, 'no share to report')
  eq(empty.flipped, false, 'and nothing flipped')

  // costShare is null rather than 0 for a losing strategy: "costs took 0%" of
  // a loss is a meaningless reassurance.
  eq(costSummary([costedResult(pos(), 1.0990, costs, { closedAt })]).costShare, null,
    'no cost share when there was no gross profit')

  eq(costSummary([null, undefined]).trades, 0, 'null results are skipped')
}

console.log(`execution: ${checks} assertions passed`)
