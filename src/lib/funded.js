// Funded / prop-firm challenge tracking — Master PRD §31–32.
//
// A prop-firm account is not a normal account with a target on top. It is a
// set of rules any one of which can end the account permanently, and the
// trader usually finds out days later. The whole point of this module is that
// the app tells them the moment it happens, from the same trade data
// everything else reads.
//
// Everything here is pure. Given the rules and a list of trades it returns the
// same answer every time, which is what lets it be tested exhaustively — and
// this is the one part of the app where being subtly wrong costs somebody an
// account.

import { isOpen, net } from './stats.js'

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

// How the maximum-loss floor moves.
//
//   static   — a fixed line under the starting balance. Most evaluation phases.
//   trailing — the line follows the account's high-water mark up, and never
//              back down. Most funded phases. This is the rule that catches
//              people out: giving profit back can breach an account that is
//              still up on the day and up overall.
export const DRAWDOWN_TYPES = {
  static: { label: 'Static', hint: 'Floor sits under the starting balance and never moves.' },
  trailing: { label: 'Trailing', hint: 'Floor follows your highest balance up, never down.' },
}

export const DEFAULT_RULES = {
  startingBalance: 100000,
  profitTarget: 8000,
  dailyLossLimit: 5000,
  maxLoss: 10000,
  minTradingDays: 4,
  // Share of total profit allowed to come from the single best day. null = the
  // firm has no consistency rule. 0.4 is a common figure.
  consistencyLimit: null,
  drawdownType: 'static',
  // Minutes to add to UTC to reach the account's own day boundary. Prop firms
  // reset at their server's midnight, not yours — a US firm on EST resets at
  // 05:00 UTC, so the offset is -300. Hard-coding this would mis-attribute
  // every trade near the boundary, and the boundary is exactly where the daily
  // loss limit bites.
  dayResetOffsetMinutes: 0,
}

export function normaliseRules(raw = {}) {
  const r = { ...DEFAULT_RULES, ...raw }
  return {
    startingBalance: num(r.startingBalance, DEFAULT_RULES.startingBalance),
    profitTarget: positiveOrNull(r.profitTarget),
    dailyLossLimit: positiveOrNull(r.dailyLossLimit),
    maxLoss: positiveOrNull(r.maxLoss),
    minTradingDays: Math.max(0, Math.floor(num(r.minTradingDays, 0))),
    consistencyLimit: fractionOrNull(r.consistencyLimit),
    drawdownType: DRAWDOWN_TYPES[r.drawdownType] ? r.drawdownType : 'static',
    dayResetOffsetMinutes: Math.trunc(num(r.dayResetOffsetMinutes, 0)),
  }
}

function num(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// A limit of zero means "no limit", not "breach immediately". Every firm
// expresses an absent rule as a blank field, and blank fields arrive as 0.
function positiveOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function fractionOrNull(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  // Accept 40 and 0.4 as the same rule; the field is labelled as a percentage
  // in the UI but stored as a fraction.
  return n > 1 ? Math.min(n / 100, 1) : n
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

/**
 * The account's own calendar day for a timestamp, as `YYYY-MM-DD`.
 *
 * Shifting the instant and then reading it in UTC is the only way to do this
 * without a timezone library: adding the offset moves the boundary to
 * midnight UTC, where `toISOString` can find it.
 */
export function accountDay(ms, offsetMinutes = 0) {
  if (!Number.isFinite(ms)) return null
  return new Date(ms + offsetMinutes * 60000).toISOString().slice(0, 10)
}

export function tradeTime(t) {
  const ms = new Date(t?.closed_at || t?.traded_at).getTime()
  return Number.isFinite(ms) ? ms : null
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export const STATUS = { active: 'ACTIVE', passed: 'PASSED', failed: 'FAILED' }

export const BREACH_REASONS = {
  daily: 'Daily loss limit',
  max: 'Maximum loss',
}

/**
 * Walk the account forward one trade at a time and report where it stands.
 *
 * Open trades are excluded. Their P&L floats, and a floating number that later
 * recovers would otherwise record a permanent breach that never happened. The
 * cost of that choice is real and worth stating: a firm measures the daily
 * loss on *equity*, so an open position deep underwater can breach an account
 * that this function still calls ACTIVE. The UI says so rather than pretending
 * otherwise.
 *
 * @param {object} rawRules  the challenge rules
 * @param {Array}  trades    trades on this account, any order
 * @param {number} now       clock injected so tests are deterministic
 */
export function evaluate(rawRules, trades = [], now = Date.now()) {
  const rules = normaliseRules(rawRules)
  const off = rules.dayResetOffsetMinutes

  const closed = (trades || [])
    .filter((t) => !isOpen(t) && tradeTime(t) !== null)
    .map((t) => ({ ms: tradeTime(t), pnl: net(t) }))
    .sort((a, b) => a.ms - b.ms)

  let balance = rules.startingBalance
  let peak = rules.startingBalance
  // The balance the current day opened at — what the daily limit measures
  // against. Firms compare to the *opening balance of that day*, not to the
  // day's own high, so a profitable morning really does cushion the afternoon:
  // up 3,000 then down 5,500 is 2,500 against the limit, not 8,500.
  let dayOpen = rules.startingBalance
  let currentDay = null

  const days = new Map() // day → net P&L
  let breach = null      // first breach only; the account ends there

  for (const t of closed) {
    const day = accountDay(t.ms, off)
    if (day !== currentDay) {
      currentDay = day
      dayOpen = balance
    }

    balance += t.pnl
    if (balance > peak) peak = balance
    days.set(day, (days.get(day) || 0) + t.pnl)

    if (breach) continue // already dead; later trades change nothing

    if (rules.dailyLossLimit !== null && dayOpen - balance > rules.dailyLossLimit) {
      breach = { reason: 'daily', at: t.ms, day, amount: dayOpen - balance, limit: rules.dailyLossLimit }
    } else if (rules.maxLoss !== null && floorFor(rules, peak) - balance > 1e-9) {
      breach = { reason: 'max', at: t.ms, day, amount: floorFor(rules, peak) - balance, limit: rules.maxLoss }
    }
  }

  // A breached account is frozen at the moment it breached. Reporting today's
  // figures for it would suggest it is still running.
  const equity = balance
  const profit = equity - rules.startingBalance
  const floor = floorFor(rules, peak)

  const today = accountDay(now, off)
  const todayPnl = days.get(today) || 0
  const todayOpen = currentDay === today ? dayOpen : balance
  const tradingDays = days.size

  const best = bestDay(days)
  const consistency = consistencyOf(rules, days, profit)

  const targetMet = rules.profitTarget === null || profit >= rules.profitTarget
  const daysMet = tradingDays >= rules.minTradingDays
  const passed = !breach && targetMet && daysMet && consistency.ok

  return {
    rules,
    status: breach ? STATUS.failed : passed ? STATUS.passed : STATUS.active,
    breach,

    equity,
    profit,
    peak,
    floor,

    // Progress toward the target, clamped: a bar past 100% reads as a bug, and
    // a negative one has nowhere to go.
    targetProgress: rules.profitTarget === null ? null
      : clamp01(profit / rules.profitTarget),
    targetRemaining: rules.profitTarget === null ? null
      : Math.max(0, rules.profitTarget - profit),

    todayPnl,
    // How much further today can go before the daily rule ends the account.
    // Never negative: if it were, the account has already failed and `breach`
    // says so.
    dailyLossRemaining: rules.dailyLossLimit === null ? null
      : Math.max(0, rules.dailyLossLimit - (todayOpen - equity)),
    maxLossRemaining: rules.maxLoss === null ? null : Math.max(0, equity - floor),

    // Drawdown from the high-water mark, which is what a trader means by "am I
    // in drawdown" — not distance from the starting balance.
    drawdown: Math.max(0, peak - equity),
    drawdownPct: peak > 0 ? (Math.max(0, peak - equity) / peak) * 100 : 0,

    tradingDays,
    tradingDaysRemaining: Math.max(0, rules.minTradingDays - tradingDays),
    bestDay: best,
    consistency,

    // What still stands between here and PASSED, in plain words.
    outstanding: breach ? [] : [
      !targetMet && 'profit target',
      !daysMet && `${Math.max(0, rules.minTradingDays - tradingDays)} more trading day(s)`,
      !consistency.ok && 'consistency rule',
    ].filter(Boolean),

    days: [...days.entries()]
      .map(([day, pnl]) => ({ day, pnl }))
      .sort((a, b) => (a.day < b.day ? -1 : 1)),
  }
}

function floorFor(rules, peak) {
  if (rules.maxLoss === null) return -Infinity
  const base = rules.drawdownType === 'trailing' ? peak : rules.startingBalance
  return base - rules.maxLoss
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function bestDay(days) {
  let best = null
  for (const [day, pnl] of days) {
    if (pnl > 0 && (!best || pnl > best.pnl)) best = { day, pnl }
  }
  return best
}

/**
 * The consistency rule: no single day may account for more than a set share of
 * total profit.
 *
 * Only meaningful once the account is in profit. Below that the ratio is
 * either undefined or wildly large for reasons that have nothing to do with
 * consistency, so it is reported as not-yet-applicable rather than as a
 * failure — and a trader who is down does not need a second red panel.
 */
export function consistencyOf(rules, days, profit) {
  if (rules.consistencyLimit === null) return { ok: true, applicable: false, limit: null, share: null }
  if (profit <= 0) return { ok: true, applicable: false, limit: rules.consistencyLimit, share: null }
  const best = bestDay(days)
  if (!best) return { ok: true, applicable: false, limit: rules.consistencyLimit, share: null }
  const share = best.pnl / profit
  return {
    ok: share <= rules.consistencyLimit + 1e-9,
    applicable: true,
    limit: rules.consistencyLimit,
    share,
    day: best.day,
    // What the account has to make on other days to bring the share back in
    // line. Being told the rule is broken is much less useful than being told
    // the amount that fixes it — and it is fixable right up until payout.
    profitNeeded: share <= rules.consistencyLimit
      ? 0
      : Math.max(0, best.pnl / rules.consistencyLimit - profit),
  }
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

export function statusTone(status) {
  if (status === STATUS.passed) return 'good'
  if (status === STATUS.failed) return 'bad'
  return 'neutral'
}

export function describeBreach(breach) {
  if (!breach) return null
  const label = BREACH_REASONS[breach.reason] || 'Rule'
  return `${label} breached on ${breach.day} — ${fmtMoney(breach.amount)} against a ${fmtMoney(breach.limit)} limit.`
}

export function fmtMoney(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`
}
