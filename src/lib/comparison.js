// Backtest vs live — Master PRD §67.
//
// The question this answers is not "did I make more money than the backtest",
// which is mostly noise. It is "am I trading the strategy I tested".
//
// Those come apart in specific, diagnosable ways, and each has a different
// fix:
//
//   win rate down, average loss unchanged   → the setup isn't what you thought
//   win rate similar, average loss worse    → you aren't honouring your stops
//   both similar, far more trades per day   → you're taking setups you didn't test
//   average win smaller, win rate up        → you're cutting winners early
//
// ── The trap this module exists to avoid ───────────────────────────────────
// The obvious version of this feature puts two win rates side by side with a
// red arrow between them, and is worse than useless: with 15 live trades a
// ten-point gap is entirely ordinary noise, and a trader shown a red arrow
// will change a strategy that was fine. So every comparison here carries how
// much evidence it rests on, and differences that a sample this size cannot
// support are reported as "not enough data" rather than as findings.

import { net, realised } from './stats.js'

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * The behavioural summary of a set of trades.
 *
 * Deliberately not total P&L. A backtest over three months and a live account
 * over three weeks will differ in total by construction, and comparing them
 * would say nothing except that they covered different amounts of time.
 * Everything here is a per-trade or per-day rate, which is comparable.
 */
export function profile(trades) {
  const list = realised(trades || [])
  const n = list.length
  const wins = list.filter((t) => net(t) > 0)
  const losses = list.filter((t) => net(t) < 0)

  const grossWin = wins.reduce((s, t) => s + net(t), 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + net(t), 0))
  const total = list.reduce((s, t) => s + net(t), 0)

  const avgWin = wins.length ? grossWin / wins.length : 0
  const avgLoss = losses.length ? grossLoss / losses.length : 0

  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: n ? (wins.length / n) * 100 : 0,
    avgWin,
    avgLoss,
    expectancy: n ? total / n : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin ? Infinity : 0,
    // The payoff ratio is what a trader means by "my R" — how big a winner is
    // against a loser, independent of how often either happens.
    payoff: avgLoss ? avgWin / avgLoss : avgWin ? Infinity : 0,
    holdMinutes: medianHold(list),
    tradesPerDay: perDay(list),
    tradingDays: distinctDays(list).size,
  }
}

function distinctDays(list) {
  const days = new Set()
  for (const t of list) {
    const ms = new Date(t.closed_at || t.traded_at).getTime()
    if (Number.isFinite(ms)) days.add(Math.floor(ms / 86400000))
  }
  return days
}

/**
 * Trades per *trading* day, not per calendar day.
 *
 * Dividing by elapsed calendar days would punish a swing trader for taking
 * weekends off, and would make any comparison between a dense backtest and a
 * sparse live record meaningless.
 */
function perDay(list) {
  const days = distinctDays(list).size
  return days ? list.length / days : 0
}

/**
 * Median rather than mean hold time.
 *
 * One trade left open over a weekend drags a mean into uselessness, and hold
 * time is exactly the metric where that happens.
 */
function medianHold(list) {
  const spans = list
    .map((t) => {
      const open = new Date(t.opened_at || t.traded_at).getTime()
      const close = new Date(t.closed_at || t.traded_at).getTime()
      return Number.isFinite(open) && Number.isFinite(close) ? (close - open) / 60000 : null
    })
    .filter((v) => v !== null && v >= 0)
    .sort((a, b) => a - b)

  if (!spans.length) return null
  const mid = Math.floor(spans.length / 2)
  return spans.length % 2 ? spans[mid] : (spans[mid - 1] + spans[mid]) / 2
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

// Below this, a difference in rates is not worth showing at all. Thirty is not
// a magic number — it is the point below which the confidence interval on a
// win rate is wider than any difference a trader would act on, so reporting
// one is theatre.
export const MIN_SAMPLE = 30

/**
 * Is a difference in win rate more than this much data can explain?
 *
 * A two-proportion z-test. It is the right tool here and cheap to compute:
 * wins out of trades really are Bernoulli draws, which is not true of the
 * money metrics below.
 *
 * Returns `null` when either side is too small — deliberately not `false`,
 * because "no evidence of a difference" and "not enough data to look" are
 * different answers and only one of them should reassure anyone.
 */
export function winRateSignificance(a, b) {
  if (!a || !b || a.trades < MIN_SAMPLE || b.trades < MIN_SAMPLE) return null

  const p1 = a.wins / a.trades
  const p2 = b.wins / b.trades
  const pooled = (a.wins + b.wins) / (a.trades + b.trades)
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.trades + 1 / b.trades))
  if (!se) return { z: 0, significant: false, pooled }

  const z = (p1 - p2) / se
  return {
    z,
    // 1.96 ≈ 95%. Two-tailed, because live can diverge in either direction and
    // a strategy doing better than tested is also worth knowing about.
    significant: Math.abs(z) >= 1.96,
    pooled,
  }
}

/**
 * How much weight a money-metric difference can carry.
 *
 * There is no honest p-value here. Trade P&L is skewed, heavy-tailed and
 * serially correlated, and a t-test on thirty trades of it would be a
 * confident-looking number with nothing behind it. So this reports the size of
 * the difference and the size of the sample, and lets the UI say "suggestive"
 * rather than "significant".
 */
export function confidence(a, b) {
  const n = Math.min(a?.trades || 0, b?.trades || 0)
  if (n < 10) return 'none'
  if (n < MIN_SAMPLE) return 'weak'
  if (n < 100) return 'moderate'
  return 'good'
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

// Each metric carries which direction is bad, and how big a gap is worth
// mentioning. The thresholds are relative, so they hold whether the account is
// $2,000 or $200,000.
const METRICS = [
  { key: 'winRate', label: 'Win rate', unit: '%', worse: 'lower', tolerance: 0.15, digits: 1 },
  { key: 'avgWin', label: 'Average win', unit: 'money', worse: 'lower', tolerance: 0.15 },
  { key: 'avgLoss', label: 'Average loss', unit: 'money', worse: 'higher', tolerance: 0.15 },
  { key: 'payoff', label: 'Payoff ratio', unit: 'x', worse: 'lower', tolerance: 0.15, digits: 2 },
  { key: 'expectancy', label: 'Expectancy', unit: 'money', worse: 'lower', tolerance: 0.2 },
  { key: 'tradesPerDay', label: 'Trades per day', unit: 'n', worse: 'higher', tolerance: 0.3, digits: 2 },
  { key: 'holdMinutes', label: 'Median hold', unit: 'minutes', worse: null, tolerance: 0.4 },
]

/**
 * Compare a backtest against live trading.
 *
 * @param backtest trades from a replay, in live-trade shape (toTradeRows)
 * @param live     real trades
 */
export function compare(backtest, live) {
  const bt = profile(backtest)
  const lv = profile(live)
  const conf = confidence(bt, lv)
  const wr = winRateSignificance(bt, lv)

  const rows = METRICS.map((m) => {
    const a = bt[m.key]
    const b = lv[m.key]
    const known = Number.isFinite(a) && Number.isFinite(b)
    // A relative gap, except where the baseline is ~0 — dividing by it there
    // produces enormous percentages that mean nothing.
    const base = Math.abs(a)
    const delta = known ? b - a : null
    const relative = known && base > 1e-9 ? delta / base : null

    let direction = 'same'
    if (relative !== null && Math.abs(relative) > m.tolerance) {
      const worseWhenHigher = m.worse === 'higher'
      const worseWhenLower = m.worse === 'lower'
      if (delta > 0) direction = worseWhenHigher ? 'worse' : worseWhenLower ? 'better' : 'different'
      else direction = worseWhenLower ? 'worse' : worseWhenHigher ? 'better' : 'different'
    }

    return {
      ...m,
      backtest: a,
      live: b,
      delta,
      relative,
      direction,
      // The win rate is the one metric with a real test behind it. Everything
      // else says how much data it rests on and stops there.
      evidence: m.key === 'winRate'
        ? (wr === null ? 'insufficient' : wr.significant ? 'significant' : 'within noise')
        : conf,
    }
  })

  return {
    backtest: bt,
    live: lv,
    rows,
    confidence: conf,
    winRateTest: wr,
    enough: bt.trades >= MIN_SAMPLE && lv.trades >= MIN_SAMPLE,
    findings: diagnose(rows, bt, lv, conf),
  }
}

/**
 * Turn the rows into the four or five things actually worth saying.
 *
 * A table of deltas is data; this is the part that tells a trader what to do
 * on Monday. Each finding names the pattern, not just the number, because
 * "your average loss is 40% bigger than tested" and "you are not honouring
 * your stops" are the same fact and only one of them changes behaviour.
 */
export function diagnose(rows, bt, lv, conf) {
  const findings = []
  const by = (key) => rows.find((r) => r.key === key)

  if (lv.trades === 0) {
    return [{
      kind: 'no-live',
      severity: 'info',
      title: 'No live trades to compare against yet',
      detail: 'Trade this strategy live and this page will tell you whether you are executing what you tested.',
    }]
  }
  if (bt.trades === 0) {
    return [{
      kind: 'no-backtest',
      severity: 'info',
      title: 'No backtest to compare against',
      detail: 'Run a replay and save the session, then come back.',
    }]
  }

  // Said first and unconditionally when true, so nothing below it is read as
  // more certain than it is.
  if (conf === 'none' || conf === 'weak') {
    findings.push({
      kind: 'small-sample',
      severity: 'info',
      title: `Only ${Math.min(bt.trades, lv.trades)} trades on the smaller side`,
      detail: `Differences below are worth watching, not acting on. Around ${MIN_SAMPLE} on both sides is where a win-rate gap starts to mean something.`,
    })
  }

  const loss = by('avgLoss')
  const win = by('avgWin')
  const wr = by('winRate')
  const freq = by('tradesPerDay')
  const hold = by('holdMinutes')

  // The diagnosis a journal exists to deliver.
  if (loss?.direction === 'worse') {
    findings.push({
      kind: 'stops',
      severity: 'high',
      title: 'Your losers are bigger live than in testing',
      detail: `Average loss is ${pct(loss.relative)} larger than the backtest. That is what moving a stop, or not setting one, looks like in the numbers.`,
    })
  }

  if (win?.direction === 'worse' && wr?.direction !== 'worse') {
    findings.push({
      kind: 'cutting-winners',
      severity: 'medium',
      title: 'You are cutting winners short',
      detail: `Your win rate has held up but the average winner is ${pct(Math.abs(win.relative))} smaller. Closing at the first sign of trouble shows up exactly like this.`,
    })
  }

  if (wr?.direction === 'worse' && wr.evidence === 'significant') {
    findings.push({
      kind: 'setup',
      severity: 'high',
      title: 'The setup is winning less often than it tested',
      detail: 'This gap is larger than the sample can explain by chance. Either the entry criteria drifted, or the conditions you tested in have not repeated.',
    })
  } else if (wr?.direction === 'worse' && wr.evidence === 'within noise') {
    findings.push({
      kind: 'setup-noise',
      severity: 'info',
      title: 'Win rate is lower live, but within noise',
      detail: 'A gap this size on this many trades is ordinary variance. Worth revisiting once you have more of them.',
    })
  }

  if (freq?.direction === 'worse') {
    findings.push({
      kind: 'overtrading',
      severity: 'medium',
      title: 'You are taking more trades per day than you tested',
      detail: `${fmt(lv.tradesPerDay, 2)} a day against ${fmt(bt.tradesPerDay, 2)} in the backtest. The extra ones are setups the test never scored.`,
    })
  }

  if (hold && hold.direction === 'different' && Number.isFinite(hold.relative)) {
    findings.push({
      kind: 'hold',
      severity: 'low',
      title: hold.delta < 0 ? 'You are closing sooner than you tested' : 'You are holding longer than you tested',
      detail: `Median hold is ${fmtMinutes(lv.holdMinutes)} live against ${fmtMinutes(bt.holdMinutes)} in the backtest.`,
    })
  }

  // The restraint applied to the win rate has to apply here too, or the module
  // fails on its own premise: an 800%-larger average loss computed from six
  // backtest trades is not evidence of anything, and presenting it in red as a
  // serious finding is exactly the mistake this file exists to avoid.
  //
  // Downgraded rather than hidden. The observation may still be the first sign
  // of a real problem, and a trader who has noticed it themselves should not
  // find the page silent about it.
  if (conf === 'none' || conf === 'weak') {
    for (const f of findings) {
      if (f.severity === 'high' || f.severity === 'medium') {
        f.severity = 'low'
        f.provisional = true
        f.detail += ' On this few trades that is an observation, not a finding — check it again once you have more.'
      }
    }
  }

  // Worth saying out loud, because the whole page is framed around divergence
  // and a trader who is executing well should be told so rather than left
  // scanning a table for a problem that isn't there.
  //
  // A downgraded observation still counts against it. "Your live trading
  // matches what you tested" printed directly above "your losers are bigger
  // live than in testing" is incoherent, and the reader believes whichever
  // they saw first.
  const anyDivergence = findings.some((f) =>
    f.severity === 'high' || f.severity === 'medium' || f.provisional)

  if (!anyDivergence) {
    findings.push({
      kind: 'aligned',
      severity: 'good',
      title: 'Your live trading matches what you tested',
      detail: 'No metric has drifted far enough to suggest you are trading a different strategy than the one you backtested.',
    })
  }

  return findings
}

function pct(relative) {
  if (!Number.isFinite(relative)) return '—'
  return `${Math.round(Math.abs(relative) * 100)}%`
}

function fmt(v, digits = 2) {
  return Number.isFinite(v) ? v.toFixed(digits) : '—'
}

export function fmtMinutes(v) {
  if (!Number.isFinite(v)) return '—'
  if (v < 60) return `${Math.round(v)}m`
  if (v < 1440) return `${(v / 60).toFixed(1)}h`
  return `${(v / 1440).toFixed(1)}d`
}
