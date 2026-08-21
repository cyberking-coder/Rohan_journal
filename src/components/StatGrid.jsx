import Money from './Money'
import { fmtDuration } from '../lib/analytics'

/**
 * The spec's "Your Stats" block: monthly best/worst/average, then the full
 * metric grid in two columns.
 *
 * The grid is defined as data rather than markup so the ordering and grouping
 * stay readable, and so adding a metric is one line rather than a block of
 * JSX copied from its neighbour.
 */
export default function StatGrid({ a, months }) {
  const best = months.length ? months.reduce((m, x) => (x.pnl > m.pnl ? x : m)) : null
  const worst = months.length ? months.reduce((m, x) => (x.pnl < m.pnl ? x : m)) : null
  const average = months.length ? months.reduce((s, x) => s + x.pnl, 0) / months.length : 0

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 18 }}>
        <MonthCard label="Best month" month={best} />
        <MonthCard label="Worst month" month={worst} />
        <MonthCard label="Average month" value={average} sub={`${months.length} month${months.length === 1 ? '' : 's'} traded`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0 34px' }}>
        {[tradeMetrics(a), dayMetrics(a)].map((column, i) => (
          <div key={i}>
            {column.map((row) => (
              <div key={row.label} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                padding: '8px 0', borderBottom: '1px solid var(--stroke)', gap: 12,
              }}>
                <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{row.label}</span>
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, textAlign: 'right' }}>
                  {row.money !== undefined
                    ? <Money value={row.money} digits={2} colored={row.colored} />
                    : row.value}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}

function MonthCard({ label, month, value, sub }) {
  const pnl = month ? month.pnl : value
  return (
    <div style={{ padding: '13px 15px', borderRadius: 12, background: 'var(--card-2)', border: '1px solid var(--stroke)' }}>
      <div style={{ fontSize: 9.5, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{label}</div>
      <div className="mono" style={{ fontSize: 19, fontWeight: 700, marginTop: 5 }}>
        {month || value !== undefined ? <Money value={pnl || 0} digits={0} colored /> : '—'}
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 3 }}>
        {sub ?? (month ? `${month.label} ${month.year} · ${month.count} trades` : 'No data yet')}
      </div>
    </div>
  )
}

const pct = (n) => `${(Number(n) || 0).toFixed(1)}%`
const num = (n) => String(Number(n) || 0)

function tradeMetrics(a) {
  return [
    { label: 'Total trades', value: num(a.tradeCount) },
    { label: 'Winners', value: num(a.winCount) },
    { label: 'Losers', value: num(a.lossCount) },
    { label: 'Break-even', value: num(a.breakEvenCount) },
    { label: 'Open positions', value: num(a.openCount) },
    { label: 'Win rate', value: pct(a.winRate) },
    { label: 'Gross profit', money: a.grossProfit, colored: true },
    { label: 'Gross loss', money: a.grossLoss, colored: true },
    { label: 'Average win', money: a.avgWin, colored: true },
    { label: 'Average loss', money: a.avgLoss, colored: true },
    { label: 'Best trade', money: a.bestTrade, colored: true },
    { label: 'Worst trade', money: a.worstTrade, colored: true },
    { label: 'Risk / reward', value: a.riskReward ? `${a.riskReward.toFixed(2)} : 1` : '—' },
    { label: 'Longest win streak', value: num(a.winStreak) },
    { label: 'Longest loss streak', value: num(a.lossStreak) },
    { label: 'Commission paid', money: a.totalCommission },
    { label: 'Swap paid', money: a.totalSwap },
  ]
}

function dayMetrics(a) {
  return [
    { label: 'Trading days', value: num(a.tradingDays) },
    { label: 'Winning days', value: num(a.winningDays) },
    { label: 'Losing days', value: num(a.losingDays) },
    { label: 'Break-even days', value: num(a.breakEvenDays) },
    { label: 'Max consecutive winning days', value: num(a.maxConsecutiveWinningDays) },
    { label: 'Max consecutive losing days', value: num(a.maxConsecutiveLosingDays) },
    { label: 'Average daily P&L', money: a.avgDailyPnl, colored: true },
    { label: 'Average winning day', money: a.avgWinningDayPnl, colored: true },
    { label: 'Average losing day', money: a.avgLosingDayPnl, colored: true },
    { label: 'Largest profitable day', money: a.largestProfitableDay, colored: true },
    { label: 'Largest losing day', money: a.largestLosingDay, colored: true },
    { label: 'Average trades per day', value: a.avgDailyVolume.toFixed(1) },
    { label: 'Max drawdown', money: a.maxDrawdown, colored: true },
    // Deliberately shows a dash rather than 0% when equity never rose above
    // its starting point: there is no peak to measure the fall against, and
    // printing 0% is the bug the spec tells us not to reproduce.
    { label: 'Max drawdown %', value: a.maxDrawdownPct === null ? '—' : pct(a.maxDrawdownPct) },
    { label: 'Average hold time', value: fmtDuration(a.avgHoldMinutes) },
    { label: 'Average hold (winners)', value: fmtDuration(a.avgHoldMinutesWinners) },
    { label: 'Average hold (losers)', value: fmtDuration(a.avgHoldMinutesLosers) },
  ]
}
