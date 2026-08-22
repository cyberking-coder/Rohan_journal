// Funded-account rule engine.
//
// The bar for this file is higher than for the rest of the suite: a wrong
// answer here tells someone their prop account is alive when it is dead, or
// dead when it is alive. So the cases below are mostly the awkward ones —
// boundaries, ordering, offsets, and rules interacting.

import assert from 'node:assert/strict'
import {
  STATUS, accountDay, consistencyOf, describeBreach, evaluate, normaliseRules,
} from '../src/lib/funded.js'

let checks = 0
function ok(cond, msg) { assert.ok(cond, msg); checks++ }
function eq(a, b, msg) { assert.deepEqual(a, b, msg); checks++ }
function near(a, b, msg) { assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`); checks++ }

// A trade at a given UTC instant with a given net result.
function trade(iso, pnl, extra = {}) {
  return { traded_at: iso, closed_at: iso, pnl, fees: 0, ...extra }
}

const BASE = {
  startingBalance: 100000,
  profitTarget: 8000,
  dailyLossLimit: 5000,
  maxLoss: 10000,
  minTradingDays: 4,
  drawdownType: 'static',
}

// ── rule normalisation ─────────────────────────────────────────────────────
{
  const r = normaliseRules({})
  eq(r.drawdownType, 'static', 'defaults to a static floor')

  // Blank fields arrive as 0 and must mean "no rule", not "fail instantly".
  const none = normaliseRules({ ...BASE, dailyLossLimit: 0, maxLoss: 0, profitTarget: 0 })
  eq(none.dailyLossLimit, null, 'zero daily limit means no daily limit')
  eq(none.maxLoss, null, 'zero max loss means no max loss')
  eq(none.profitTarget, null, 'zero target means no target')

  eq(normaliseRules({ consistencyLimit: 40 }).consistencyLimit, 0.4, '40 reads as 40%')
  eq(normaliseRules({ consistencyLimit: 0.4 }).consistencyLimit, 0.4, '0.4 reads as 40%')
  eq(normaliseRules({ consistencyLimit: null }).consistencyLimit, null, 'no consistency rule')
  eq(normaliseRules({ drawdownType: 'nonsense' }).drawdownType, 'static', 'unknown type falls back')
  eq(normaliseRules({ minTradingDays: 3.7 }).minTradingDays, 3, 'trading days are whole')

  // A garbage starting balance must not become NaN and poison every figure.
  eq(normaliseRules({ startingBalance: 'abc' }).startingBalance, 100000, 'bad balance falls back')
}

// ── account days ───────────────────────────────────────────────────────────
{
  const ms = Date.parse('2026-03-10T02:30:00Z')
  eq(accountDay(ms, 0), '2026-03-10', 'UTC day')
  // A firm resetting at 17:00 EST is offset -300 minutes; 02:30 UTC is still
  // the previous trading day for them.
  eq(accountDay(ms, -300), '2026-03-09', 'negative offset rolls back a day')
  eq(accountDay(ms, 600), '2026-03-10', 'positive offset stays')
  eq(accountDay(Date.parse('2026-03-09T23:00:00Z'), 120), '2026-03-10', 'offset rolls forward')
  eq(accountDay(NaN, 0), null, 'no day for an unparseable time')
}

// ── the happy path ─────────────────────────────────────────────────────────
{
  const trades = [
    trade('2026-03-02T10:00:00Z', 2500),
    trade('2026-03-03T10:00:00Z', 2000),
    trade('2026-03-04T10:00:00Z', 2000),
    trade('2026-03-05T10:00:00Z', 2000),
  ]
  const r = evaluate(BASE, trades, Date.parse('2026-03-05T20:00:00Z'))
  eq(r.status, STATUS.passed, 'target met over enough days passes')
  near(r.equity, 108500, 'equity')
  near(r.profit, 8500, 'profit')
  eq(r.tradingDays, 4, 'four distinct days')
  near(r.targetProgress, 1, 'progress clamps at 100%')
  eq(r.targetRemaining, 0, 'nothing left to make')
  eq(r.outstanding.length, 0, 'nothing outstanding')
  eq(r.breach, null, 'no breach')
}

// Target hit, but not enough days — the commonest reason a passing-looking
// account is still ACTIVE.
{
  const r = evaluate(BASE, [
    trade('2026-03-02T10:00:00Z', 5000),
    trade('2026-03-03T10:00:00Z', 4000),
  ], Date.parse('2026-03-03T20:00:00Z'))
  eq(r.status, STATUS.active, 'target alone is not a pass')
  eq(r.tradingDaysRemaining, 2, 'two days short')
  ok(r.outstanding.some((s) => /trading day/.test(s)), 'says which rule is outstanding')
  ok(!r.outstanding.some((s) => s === 'profit target'), 'target is not outstanding')
}

// ── daily loss limit ───────────────────────────────────────────────────────
{
  // Exactly at the limit is not a breach — firms breach on *exceeding*.
  const at = evaluate(BASE, [trade('2026-03-02T10:00:00Z', -5000)], Date.parse('2026-03-02T20:00:00Z'))
  eq(at.status, STATUS.active, 'losing exactly the daily limit survives')
  eq(at.dailyLossRemaining, 0, 'with nothing left for the day')

  const over = evaluate(BASE, [trade('2026-03-02T10:00:00Z', -5000.01)], Date.parse('2026-03-02T20:00:00Z'))
  eq(over.status, STATUS.failed, 'a cent past the limit fails')
  eq(over.breach.reason, 'daily', 'for the daily rule')
  eq(over.breach.day, '2026-03-02', 'on the right day')

  // Split across two trades on the same day — the limit is on the day, not on
  // any one trade.
  const split = evaluate(BASE, [
    trade('2026-03-02T10:00:00Z', -3000),
    trade('2026-03-02T14:00:00Z', -2500),
  ], Date.parse('2026-03-02T20:00:00Z'))
  eq(split.status, STATUS.failed, 'two losses adding past the limit fail')

  // The same two losses on different days do not.
  const spread = evaluate(BASE, [
    trade('2026-03-02T10:00:00Z', -3000),
    trade('2026-03-03T14:00:00Z', -2500),
  ], Date.parse('2026-03-03T20:00:00Z'))
  eq(spread.status, STATUS.active, 'the limit resets overnight')

  // The limit measures from the day's *opening* balance, so a profitable
  // morning genuinely does cushion the afternoon: up 3,000 then down 5,500 is
  // only 2,500 below the open and survives, even though it is 8,500 off the
  // day's high. This is how firms compute it, and it is worth pinning down
  // because the intuitive reading — measuring from the high — would fail an
  // account that is still perfectly alive.
  const roundTrip = evaluate(BASE, [
    trade('2026-03-02T09:00:00Z', 3000),
    trade('2026-03-02T15:00:00Z', -5500),
  ], Date.parse('2026-03-02T20:00:00Z'))
  eq(roundTrip.status, STATUS.active, 'measured from the day open, not the day high')
  near(roundTrip.dailyLossRemaining, 2500, 'with 2,500 of the day left')

  // Push the same day past the open by more than the limit and it does fail.
  const past = evaluate(BASE, [
    trade('2026-03-02T09:00:00Z', 3000),
    trade('2026-03-02T15:00:00Z', -8100),
  ], Date.parse('2026-03-02T20:00:00Z'))
  eq(past.status, STATUS.failed, 'more than the limit below the open fails')
  near(past.breach.amount, 5100, 'by the amount below the open')
}

// The day boundary is the offset's, not UTC's. Two losses either side of
// midnight UTC are one day for a firm resetting at 22:00 UTC.
{
  const rules = { ...BASE, dayResetOffsetMinutes: 120 }
  const trades = [
    trade('2026-03-02T23:00:00Z', -3000),
    trade('2026-03-03T01:00:00Z', -2500),
  ]
  eq(evaluate(rules, trades, Date.parse('2026-03-03T05:00:00Z')).status, STATUS.failed,
    'offset merges them into one trading day')
  eq(evaluate({ ...BASE, dayResetOffsetMinutes: 0 }, trades, Date.parse('2026-03-03T05:00:00Z')).status,
    STATUS.active, 'in UTC they are two days and both survive')
}

// ── maximum loss ───────────────────────────────────────────────────────────
{
  // Under the daily limit every day, but the total floor still catches it.
  const r = evaluate(BASE, [
    trade('2026-03-02T10:00:00Z', -4000),
    trade('2026-03-03T10:00:00Z', -4000),
    trade('2026-03-04T10:00:00Z', -2500),
  ], Date.parse('2026-03-04T20:00:00Z'))
  eq(r.status, STATUS.failed, 'the overall floor fails it')
  eq(r.breach.reason, 'max', 'for the max-loss rule')
  near(r.floor, 90000, 'a static floor sits under the starting balance')
}

{
  // Trailing: up 5,000 then giving back 10,500 breaches, even though the
  // account is still ahead of where it started. This is the rule people lose
  // accounts to without understanding why.
  const rules = { ...BASE, drawdownType: 'trailing', dailyLossLimit: null }
  const r = evaluate(rules, [
    trade('2026-03-02T10:00:00Z', 5000),
    trade('2026-03-03T10:00:00Z', -10500),
  ], Date.parse('2026-03-03T20:00:00Z'))
  eq(r.status, STATUS.failed, 'trailing floor breached while still near start')
  near(r.peak, 105000, 'peak recorded')
  near(r.floor, 95000, 'floor followed the peak up')
  near(r.equity, 94500, 'and equity fell through it')

  // The identical trades under a static floor survive.
  const stat = evaluate({ ...rules, drawdownType: 'static' }, [
    trade('2026-03-02T10:00:00Z', 5000),
    trade('2026-03-03T10:00:00Z', -10500),
  ], Date.parse('2026-03-03T20:00:00Z'))
  eq(stat.status, STATUS.active, 'a static floor is not reached by the same trades')

  // The floor never moves back down.
  const back = evaluate(rules, [
    trade('2026-03-02T10:00:00Z', 5000),
    trade('2026-03-03T10:00:00Z', -8000),
    trade('2026-03-04T10:00:00Z', -2500),
  ], Date.parse('2026-03-04T20:00:00Z'))
  near(back.floor, 95000, 'floor stays at the high-water mark')
  eq(back.status, STATUS.failed, 'so the second loss breaches, at 94,500')
}

// ── a breach is permanent ──────────────────────────────────────────────────
{
  const r = evaluate(BASE, [
    trade('2026-03-02T10:00:00Z', -6000),   // breach
    trade('2026-03-03T10:00:00Z', 20000),   // a spectacular recovery
    trade('2026-03-04T10:00:00Z', 5000),
    trade('2026-03-05T10:00:00Z', 5000),
  ], Date.parse('2026-03-05T20:00:00Z'))
  eq(r.status, STATUS.failed, 'no amount of profit revives a breached account')
  eq(r.breach.day, '2026-03-02', 'the first breach is the one that counts')
  eq(r.outstanding.length, 0, 'and nothing is outstanding on a dead account')
}

// ── ordering and open trades ───────────────────────────────────────────────
{
  // Given out of order, the engine must still see the sequence as it happened:
  // sorted, these breach; unsorted and taken naively, they would not.
  const jumbled = evaluate({ ...BASE, dailyLossLimit: null, drawdownType: 'trailing', maxLoss: 6000 }, [
    trade('2026-03-03T10:00:00Z', -8000),
    trade('2026-03-02T10:00:00Z', 3000),
  ], Date.parse('2026-03-03T20:00:00Z'))
  eq(jumbled.status, STATUS.failed, 'trades are sequenced by time, not by array order')
  near(jumbled.peak, 103000, 'the earlier winner set the peak first')

  // Floating P&L on an open position is not realised and must not breach.
  const open = evaluate(BASE, [
    trade('2026-03-02T10:00:00Z', -9000, { status: 'open' }),
  ], Date.parse('2026-03-02T20:00:00Z'))
  eq(open.status, STATUS.active, 'an open loser does not breach')
  near(open.equity, 100000, 'and is not counted in equity')
  eq(open.tradingDays, 0, 'nor does it count as a trading day')

  // Fees are part of the result.
  const fees = evaluate({ ...BASE, dailyLossLimit: 100 },
    [{ traded_at: '2026-03-02T10:00:00Z', closed_at: '2026-03-02T10:00:00Z', pnl: -50, fees: 80 }],
    Date.parse('2026-03-02T20:00:00Z'))
  eq(fees.status, STATUS.failed, 'fees count toward the daily loss')
}

// ── today's figures ────────────────────────────────────────────────────────
{
  const trades = [
    trade('2026-03-02T10:00:00Z', 1000),
    trade('2026-03-05T10:00:00Z', -1500),
    trade('2026-03-05T14:00:00Z', 500),
  ]
  const r = evaluate(BASE, trades, Date.parse('2026-03-05T20:00:00Z'))
  near(r.todayPnl, -1000, "today's P&L is only today's trades")
  near(r.dailyLossRemaining, 4000, 'and the day still has room')
  // Peak was 101,000 after the first day; equity is back to 100,000.
  near(r.drawdown, 1000, 'drawdown is measured from the peak, not the start')
  near(r.maxLossRemaining, 10000, 'distance to the static floor at 90,000')

  // On a day with no trades yet, the full daily allowance is available.
  const quiet = evaluate(BASE, trades, Date.parse('2026-03-06T09:00:00Z'))
  near(quiet.todayPnl, 0, 'no trades today')
  near(quiet.dailyLossRemaining, 5000, 'so the whole limit is available')
  eq(quiet.tradingDays, 2, 'and the day count is unchanged')
}

// ── consistency ────────────────────────────────────────────────────────────
{
  const rules = { ...BASE, consistencyLimit: 0.4, minTradingDays: 3 }

  // One day carrying 80% of the profit.
  const lumpy = evaluate(rules, [
    trade('2026-03-02T10:00:00Z', 8000),
    trade('2026-03-03T10:00:00Z', 1000),
    trade('2026-03-04T10:00:00Z', 1000),
  ], Date.parse('2026-03-04T20:00:00Z'))
  eq(lumpy.status, STATUS.active, 'a lumpy account has not passed')
  eq(lumpy.consistency.ok, false, 'consistency fails')
  near(lumpy.consistency.share, 0.8, 'the share is reported')
  // 8000 / 0.4 = 20000 total needed, so 10000 more.
  near(lumpy.consistency.profitNeeded, 10000, 'and the amount that would fix it')
  ok(lumpy.outstanding.includes('consistency rule'), 'listed as outstanding')

  const even = evaluate(rules, [
    trade('2026-03-02T10:00:00Z', 3000),
    trade('2026-03-03T10:00:00Z', 3000),
    trade('2026-03-04T10:00:00Z', 3000),
  ], Date.parse('2026-03-04T20:00:00Z'))
  eq(even.status, STATUS.passed, 'an even account passes')
  eq(even.consistency.ok, true, 'consistency satisfied')
  eq(even.consistency.profitNeeded, 0, 'nothing needed')

  // Exactly at the limit passes.
  const days = new Map([['a', 4000], ['b', 6000]])
  eq(consistencyOf(normaliseRules({ consistencyLimit: 0.6 }), days, 10000).ok, true,
    'a best day of exactly the limit is allowed')
  eq(consistencyOf(normaliseRules({ consistencyLimit: 0.59 }), days, 10000).ok, false,
    'a hair over is not')

  // While the account is down the rule says nothing.
  const losing = evaluate(rules, [
    trade('2026-03-02T10:00:00Z', 500),
    trade('2026-03-03T10:00:00Z', -2000),
  ], Date.parse('2026-03-03T20:00:00Z'))
  eq(losing.consistency.applicable, false, 'not applicable below breakeven')
  eq(losing.consistency.ok, true, 'and not reported as a failure')
}

// ── empty and absent ───────────────────────────────────────────────────────
{
  const r = evaluate(BASE, [], Date.parse('2026-03-02T12:00:00Z'))
  eq(r.status, STATUS.active, 'a fresh account is active')
  near(r.equity, 100000, 'equity is the starting balance')
  eq(r.tradingDays, 0, 'no trading days')
  eq(r.drawdown, 0, 'no drawdown')
  near(r.dailyLossRemaining, 5000, 'full daily allowance')
  eq(r.bestDay, null, 'no best day')

  // With the loss rules switched off, an account passes on the target alone.
  // Note that *omitting* a field falls back to the default rather than to "no
  // rule" — absence is how a caller says "use the usual", and only an explicit
  // null or 0 turns a rule off.
  const bare = evaluate({
    startingBalance: 1000, profitTarget: 100, minTradingDays: 0,
    dailyLossLimit: null, maxLoss: null,
  },
    [trade('2026-03-02T10:00:00Z', 150)], Date.parse('2026-03-02T20:00:00Z'))
  eq(bare.status, STATUS.passed, 'no limits, target met')
  eq(bare.dailyLossRemaining, null, 'and no daily figure to show')
  eq(bare.maxLossRemaining, null, 'nor a max-loss figure')

  eq(describeBreach(null), null, 'nothing to describe without a breach')
  ok(/Daily loss limit/.test(describeBreach({ reason: 'daily', day: 'x', amount: 1, limit: 2 })),
    'a breach describes itself')
}

console.log(`funded: ${checks} assertions passed`)
