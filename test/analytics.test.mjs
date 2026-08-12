import { computeAnalytics, filterTrades, maxDrawdown, fmtDuration, profitFactorLabel } from '../src/lib/analytics.js'

// Reconstruction of the 10-trade account the spec documents, matching every
// published aggregate: 1 win of $49.85, 9 losses totalling -$220.54, and daily
// totals of -89.85 / -82.09 / +1.25 across Aug 10-12.
const mk = (day, pnl, h = 13) => ({
  id: `${day}-${pnl}`, symbol: 'XAUUSD', side: 'Long', pnl, fees: 0, swap: 0, status: 'closed',
  opened_at: `2026-08-${day}T${String(h).padStart(2,'0')}:00:00Z`,
  closed_at: `2026-08-${day}T${String(h).padStart(2,'0')}:30:00Z`,
  traded_at: `2026-08-${day}T${String(h).padStart(2,'0')}:30:00Z`,
})
const trades = [
  mk(10,-30.70,10), mk(10,-26.15,11), mk(10,-3.00,12), mk(10,-30.00,13),
  mk(11,-33.55,10), mk(11,-24.00,11), mk(11,-24.54,12),
  mk(12,-24.30,10), mk(12, 49.85,11), mk(12,-24.30,12),
]

const a = computeAnalytics(trades)
let fails = 0
const eq = (label, got, want, tol = 0.005) => {
  const ok = typeof want === 'number' ? Math.abs(got - want) <= tol : got === want
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(28)} got ${got}${ok ? '' : `  want ${want}`}`)
}

console.log('— headline (values published in the spec) —')
eq('Total P&L',        a.totalPnl, -170.69)
eq('Win rate %',       a.winRate, 10)
eq('Profit factor',    a.profitFactor, 0.226)
eq('PF label',         a.profitFactorLabel.label, 'Needs work')
eq('Expectancy',       a.expectancy, -17.069)
eq('Avg winner',       a.avgWin, 49.85)
eq('Avg loser',        a.avgLoss, -24.504)
eq('Best trade',       a.bestTrade, 49.85)
eq('Worst trade',      a.worstTrade, -33.55)
eq('Win streak',       a.winStreak, 1)
eq('Loss streak',      a.lossStreak, 8)
eq('Risk:reward',      a.riskReward, 2.034)
eq('Gross profit',     a.grossProfit, 49.85)
eq('Gross loss',       a.grossLoss, -220.54)
eq('Open trades',      a.openCount, 0)

console.log('— day-level (values published in the spec) —')
eq('Total trading days',   a.tradingDays, 3)
eq('Winning days',         a.winningDays, 1)
eq('Losing days',          a.losingDays, 2)
eq('Avg daily P&L',        a.avgDailyPnl, -56.897)
eq('Avg winning day',      a.avgWinningDayPnl, 1.25)
eq('Avg losing day',       a.avgLosingDayPnl, -85.97)
eq('Largest profitable day', a.largestProfitableDay, 1.25)
eq('Largest losing day',   a.largestLosingDay, -89.85)
eq('Avg daily volume',     a.avgDailyVolume, 3.333)
eq('Avg hold time',        fmtDuration(a.avgHoldMinutes), '30m')

console.log('— drawdown (spec calls the live app’s 0% a bug) —')
// Equity climbs to +100 then falls to -50: a real 150 drop from a 100 peak.
const ddTrades = [mk(10,60), mk(11,40), mk(12,-150)]
const dd = maxDrawdown(ddTrades)
eq('Max drawdown $',   dd.amount, -150)
eq('Peak before trough', dd.peak, 100)
eq('Max drawdown %',   dd.pct, 150)
// Never above the starting point: a percentage has no denominator, so null
// ("—") rather than the live app's misleading 0%.
eq('DD % when never up', maxDrawdown(trades).pct, null)

console.log('— filters —')
eq('Winners only',   filterTrades(trades, { period: 'all', tradeType: 'winners' }).length, 1)
eq('Losers only',    filterTrades(trades, { period: 'all', tradeType: 'losers' }).length, 9)
eq('All time',       filterTrades(trades, { period: 'all' }).length, 10)
// The sample data is dated Aug 10-12 and today is Aug 12, so three trades
// legitimately fall inside "Today"; an older trade must fall outside it.
eq('Today',          filterTrades(trades, { period: 'today' }).length, 3)
const stale = [{ ...mk(10,-5), closed_at: '2020-01-01T00:00:00Z', traded_at: '2020-01-01T00:00:00Z' }]
eq('Today excludes old', filterTrades(stale, { period: 'today' }).length, 0)
eq('1y excludes 2020',   filterTrades(stale, { period: '1y' }).length, 0)
eq('All includes 2020',  filterTrades(stale, { period: 'all' }).length, 1)
eq('PF band >2',     profitFactorLabel(2.5).label, 'Excellent')
eq('PF band 1.5-2',  profitFactorLabel(1.7).label, 'Good')
eq('PF band 1-1.5',  profitFactorLabel(1.2).label, 'Fair')

console.log(fails ? `\n${fails} FAILED` : '\nAll assertions passed.')
process.exit(fails ? 1 : 0)
