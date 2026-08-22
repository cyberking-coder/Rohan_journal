// Backtest vs live.
//
// The thing most worth testing here is the restraint: that a fifteen-trade
// sample does NOT produce confident findings, and that "no evidence of a
// difference" stays distinguishable from "not enough data to look".

import assert from 'node:assert/strict'
import {
  MIN_SAMPLE, compare, confidence, fmtMinutes, profile, winRateSignificance,
} from '../src/lib/comparison.js'

let checks = 0
function ok(c, m) { assert.ok(c, m); checks++ }
function eq(a, b, m) { assert.deepEqual(a, b, m); checks++ }
function near(a, b, m, tol = 1e-6) { assert.ok(Math.abs(a - b) < tol, `${m}: ${a} vs ${b}`); checks++ }

// A trade closed on day `day`, held `holdMin` minutes.
function t(pnl, day = 0, holdMin = 60) {
  const close = Date.UTC(2026, 2, 2 + day, 14, 0)
  return {
    pnl, fees: 0,
    opened_at: new Date(close - holdMin * 60000).toISOString(),
    closed_at: new Date(close).toISOString(),
    traded_at: new Date(close).toISOString(),
  }
}

// n trades: `wins` winners of `win`, the rest losers of `loss`, spread over
// `days` so the per-day rate is controllable.
function set({ n, wins, win = 200, loss = 100, days = 10, hold = 60 }) {
  return Array.from({ length: n }, (_, i) =>
    t(i < wins ? win : -loss, i % days, hold))
}

// ── profile ────────────────────────────────────────────────────────────────
{
  const p = profile([t(300, 0), t(-100, 0), t(-200, 1), t(100, 1)])
  eq(p.trades, 4, 'four trades')
  eq(p.wins, 2, 'two winners')
  eq(p.losses, 2, 'two losers')
  near(p.winRate, 50, 'win rate')
  near(p.avgWin, 200, 'average win')
  near(p.avgLoss, 150, 'average loss is reported positive')
  near(p.payoff, 200 / 150, 'payoff ratio')
  near(p.expectancy, 25, 'expectancy')
  eq(p.tradingDays, 2, 'two trading days')
  near(p.tradesPerDay, 2, 'per *trading* day, not per calendar day')

  // Open trades carry floating P&L and must not be profiled as results.
  const withOpen = profile([t(300, 0), { ...t(-9000, 0), status: 'open' }])
  eq(withOpen.trades, 1, 'open trades excluded')
  near(withOpen.expectancy, 300, 'and not counted in the average')

  // Fees are part of the result, as everywhere else in the app.
  near(profile([{ pnl: 100, fees: 130, traded_at: t(0).traded_at }]).expectancy, -30,
    'fees turn a winner into a loser')

  const empty = profile([])
  eq(empty.trades, 0, 'empty profile')
  near(empty.winRate, 0, 'no division by zero')
  eq(empty.holdMinutes, null, 'no hold time to report')
  near(empty.tradesPerDay, 0, 'no rate')

  // A tail-heavy hold distribution: the median must ignore the weekend trade.
  const holds = profile([t(1, 0, 30), t(1, 1, 45), t(1, 2, 60), t(1, 3, 4320)])
  near(holds.holdMinutes, 52.5, 'median hold ignores the one long hold')

  eq(profile([{ pnl: 1, traded_at: 'nonsense' }]).holdMinutes, null,
    'an unparseable timestamp yields no hold rather than NaN')

  const noLosers = profile([t(100, 0), t(50, 0)])
  eq(noLosers.profitFactor, Infinity, 'never lost')
  eq(noLosers.payoff, Infinity, 'and no loser to measure against')
}

// ── significance ───────────────────────────────────────────────────────────
{
  // Too few trades: null, NOT false. The distinction is the point.
  const small = winRateSignificance(profile(set({ n: 20, wins: 10 })), profile(set({ n: 20, wins: 4 })))
  eq(small, null, 'below the minimum sample there is no test to report')

  // Enough trades, identical rates: a real "no difference".
  const same = winRateSignificance(profile(set({ n: 100, wins: 50 })), profile(set({ n: 100, wins: 50 })))
  ok(same !== null, 'a test was run')
  eq(same.significant, false, 'and found nothing')
  near(same.z, 0, 'z is zero for identical rates')

  // A large, real difference.
  const big = winRateSignificance(profile(set({ n: 200, wins: 120 })), profile(set({ n: 200, wins: 60 })))
  eq(big.significant, true, '60% against 30% on 200 each is not chance')
  ok(big.z > 0, 'signed toward the first argument')

  // The case the whole guard exists for: the SAME proportional gap on a small
  // sample must not be called significant.
  const sameGapSmall = winRateSignificance(profile(set({ n: 30, wins: 18 })), profile(set({ n: 30, wins: 12 })))
  ok(sameGapSmall !== null, 'at the threshold a test runs')
  eq(sameGapSmall.significant, false, 'but a 20-point gap on 30 trades is still noise')

  eq(winRateSignificance(null, null), null, 'nothing to test')

  eq(confidence(profile(set({ n: 5, wins: 3 })), profile(set({ n: 5, wins: 2 }))), 'none', 'tiny')
  eq(confidence(profile(set({ n: 15, wins: 8 })), profile(set({ n: 200, wins: 100 }))), 'weak',
    'the smaller side governs')
  eq(confidence(profile(set({ n: 50, wins: 25 })), profile(set({ n: 50, wins: 25 }))), 'moderate', 'moderate')
  eq(confidence(profile(set({ n: 150, wins: 75 })), profile(set({ n: 150, wins: 75 }))), 'good', 'good')
}

// ── compare: the diagnoses ─────────────────────────────────────────────────
const kinds = (r) => r.findings.map((f) => f.kind)

{
  // Executing faithfully: same everything.
  const bt = set({ n: 100, wins: 40 })
  const lv = set({ n: 100, wins: 40 })
  const r = compare(bt, lv)
  ok(kinds(r).includes('aligned'), 'a faithful trader is told so')
  ok(!r.findings.some((f) => f.severity === 'high'), 'and nothing is alarming')
  eq(r.enough, true, 'enough data on both sides')
  eq(r.rows.find((x) => x.key === 'winRate').direction, 'same', 'win rate unchanged')
}

{
  // Not honouring stops: same win rate, same winners, much bigger losers.
  const bt = set({ n: 100, wins: 40, win: 200, loss: 100 })
  const lv = set({ n: 100, wins: 40, win: 200, loss: 160 })
  const r = compare(bt, lv)
  ok(kinds(r).includes('stops'), 'the stop-loss diagnosis fires')
  const f = r.findings.find((x) => x.kind === 'stops')
  eq(f.severity, 'high', 'and it is the serious kind')
  ok(/60%/.test(f.detail), 'quantified')
  eq(r.rows.find((x) => x.key === 'avgLoss').direction, 'worse',
    'a bigger average loss is worse, not better')
  ok(!kinds(r).includes('aligned'), 'and the all-clear is withheld')
}

{
  // Cutting winners: win rate holds, winners shrink.
  const bt = set({ n: 100, wins: 40, win: 300, loss: 100 })
  const lv = set({ n: 100, wins: 40, win: 180, loss: 100 })
  const r = compare(bt, lv)
  ok(kinds(r).includes('cutting-winners'), 'the cutting-winners diagnosis fires')
  eq(r.rows.find((x) => x.key === 'payoff').direction, 'worse', 'payoff ratio down')
}

{
  // Overtrading: same shape, three times the frequency.
  const bt = set({ n: 100, wins: 40, days: 50 })
  const lv = set({ n: 100, wins: 40, days: 12 })
  const r = compare(bt, lv)
  ok(kinds(r).includes('overtrading'), 'the frequency diagnosis fires')
  ok(r.live.tradesPerDay > r.backtest.tradesPerDay, 'and the direction is right')
}

{
  // A genuinely broken setup, with enough trades to say so.
  const bt = set({ n: 200, wins: 120 })
  const lv = set({ n: 200, wins: 60 })
  const r = compare(bt, lv)
  ok(kinds(r).includes('setup'), 'a significant win-rate drop is called out')
  eq(r.findings.find((f) => f.kind === 'setup').severity, 'high', 'as serious')
  eq(r.rows.find((x) => x.key === 'winRate').evidence, 'significant', 'and marked significant')
}

{
  // The restraint test. The same shape of drop, on a sample too small to
  // support it, must NOT produce a confident finding.
  const bt = set({ n: 40, wins: 24 })
  const lv = set({ n: 40, wins: 16 })
  const r = compare(bt, lv)
  ok(!kinds(r).includes('setup'), 'no confident finding on a thin sample')
  ok(kinds(r).includes('setup-noise'), 'it is reported as noise instead')
  eq(r.rows.find((x) => x.key === 'winRate').evidence, 'within noise', 'and labelled as such')
}

{
  // Thinner still: the sample warning must lead.
  const bt = set({ n: 12, wins: 8 })
  const lv = set({ n: 12, wins: 2 })
  const r = compare(bt, lv)
  eq(r.findings[0].kind, 'small-sample', 'the caveat comes first')
  eq(r.enough, false, 'and the flag says so')
  eq(r.rows.find((x) => x.key === 'winRate').evidence, 'insufficient',
    'the win-rate row admits there is no test')
  ok(!kinds(r).includes('setup'), 'no confident setup finding')
}

{
  // Empty sides are handled as states, not as findings about trading.
  eq(kinds(compare(set({ n: 50, wins: 25 }), [])), ['no-live'], 'nothing live yet')
  eq(kinds(compare([], set({ n: 50, wins: 25 }))), ['no-backtest'], 'nothing tested yet')
  eq(kinds(compare([], [])).length, 1, 'both empty gives one message, not two')
}

{
  // Doing better than tested is "better", never flagged as a problem.
  const bt = set({ n: 100, wins: 40, win: 200, loss: 150 })
  const lv = set({ n: 100, wins: 40, win: 200, loss: 90 })
  const r = compare(bt, lv)
  eq(r.rows.find((x) => x.key === 'avgLoss').direction, 'better', 'smaller losses are better')
  ok(!kinds(r).includes('stops'), 'and no stop-loss warning')
}

{
  // A zero baseline must not produce an infinite percentage.
  const flat = [t(0, 0), t(0, 1)]
  const r = compare(flat, set({ n: 10, wins: 5 }))
  ok(r.rows.every((x) => x.relative === null || Number.isFinite(x.relative)),
    'no infinite relative differences')
}

// ── formatting ─────────────────────────────────────────────────────────────
{
  eq(fmtMinutes(30), '30m', 'minutes')
  eq(fmtMinutes(90), '1.5h', 'hours')
  eq(fmtMinutes(2880), '2.0d', 'days')
  eq(fmtMinutes(null), '—', 'nothing to show')
  eq(MIN_SAMPLE, 30, 'the threshold is stated once')
}


// ── restraint applies to every finding, not only the win rate ──────────────
//
// The browser caught this: a six-trade backtest against sixty live trades
// produced "Average loss is 800% larger" in red at high severity. The guard
// existed for the win rate and nowhere else, which failed the module's own
// premise.
{
  const bt = set({ n: 6, wins: 4, win: 20, loss: 30 })
  const lv = set({ n: 60, wins: 24, win: 180, loss: 260 })
  const r = compare(bt, lv)

  const stops = r.findings.find((f) => f.kind === 'stops')
  ok(stops, 'the observation is still made')
  eq(stops.severity, 'low', 'but not at a severity that demands action')
  eq(stops.provisional, true, 'and it is marked provisional')
  ok(/not a finding/.test(stops.detail), 'and says so in words')
  eq(r.findings[0].kind, 'small-sample', 'with the sample caveat still leading')

  // With enough data the same divergence is serious again.
  const big = compare(set({ n: 100, wins: 40, win: 200, loss: 100 }),
                      set({ n: 100, wins: 40, win: 200, loss: 160 }))
  eq(big.findings.find((f) => f.kind === 'stops').severity, 'high',
    'a well-evidenced divergence is still reported as serious')
  eq(big.findings.find((f) => f.kind === 'stops').provisional, undefined,
    'and is not provisional')

  // A downgraded finding must not let the all-clear through: "your trading
  // matches what you tested" alongside a red divergence would be incoherent.
  ok(!r.findings.some((f) => f.kind === 'aligned'),
    'the all-clear is still withheld while an observation stands')
}

console.log(`comparison: ${checks} assertions passed`)
