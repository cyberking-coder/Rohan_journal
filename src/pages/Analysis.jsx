import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { PageHeader, Panel } from '../components/common'
import Money from '../components/Money'
import TradingCalendar from '../components/TradingCalendar'
import StatGrid from '../components/StatGrid'
import { MistakeSummary, TagFilter, TagPerformance } from '../components/TagInsights'
import {
  ComparisonBars, DistributionChart, EquityDrawdown, MetricStrip, SessionTimeline,
} from '../components/AnalysisCharts'
import {
  DEFAULT_PERIOD, DEFAULT_TRADE_TYPE, PERIODS, PERIOD_KEYS, TRADE_TYPES, TRADE_TYPE_KEYS,
  byDayOfWeek, byDirection, bySession, bySymbol, computeAnalytics, filterTrades,
  maxDrawdown, monthlyTotals, winLossDistribution,
} from '../lib/analytics'
import { filterByTags, mistakeCost } from '../lib/tags'

export default function Analysis({ trades = [] }) {
  const [period, setPeriod] = useState(DEFAULT_PERIOD)
  const [tradeType, setTradeType] = useState(DEFAULT_TRADE_TYPE)
  const [now, setNow] = useState(() => new Date())
  const [tags, setTags] = useState([])
  const [tagMode, setTagMode] = useState('any')

  // The session timeline's NOW marker has to move, or it's a decoration that
  // quietly becomes a lie. A minute is finer than the marker can show.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])

  const scoped = useMemo(
    () => filterByTags(filterTrades(trades, { period, tradeType }), tags, tagMode),
    [trades, period, tradeType, tags, tagMode],
  )
  const a = useMemo(() => computeAnalytics(scoped, trades), [scoped, trades])

  // Deliberately computed from the *period* filter only, ignoring the
  // winners/losers pill. A curve drawn from winners alone rises forever and
  // a drawdown chart of losers only falls — both are meaningless shapes.
  // The tag filter DOES apply here, unlike the winners/losers pill: "my equity
  // curve on FVG trades" is a real and useful shape, whereas a curve of
  // winners only rises forever and means nothing.
  const curveTrades = useMemo(
    () => filterByTags(filterTrades(trades, { period, tradeType: 'all' }), tags, tagMode),
    [trades, period, tags, tagMode],
  )
  const curveStats = useMemo(() => computeAnalytics(curveTrades, trades), [curveTrades, trades])
  const dd = useMemo(() => maxDrawdown(curveTrades), [curveTrades])

  const sessions = useMemo(() => bySession(scoped), [scoped])
  const directions = useMemo(() => byDirection(scoped), [scoped])
  const weekdays = useMemo(() => byDayOfWeek(scoped), [scoped])
  const symbols = useMemo(() => bySymbol(scoped), [scoped])
  const distribution = useMemo(() => winLossDistribution(scoped), [scoped])
  const months = useMemo(() => monthlyTotals(scoped), [scoped])
  const mistakes = useMemo(() => mistakeCost(scoped), [scoped])

  const pf = a.profitFactorLabel

  const strip = [
    { label: 'Trades', value: String(curveStats.tradeCount) },
    { label: 'Net P&L', money: curveStats.totalPnl, colored: true },
    { label: 'Best trade', money: curveStats.bestTrade, colored: true },
    { label: 'Worst trade', money: curveStats.worstTrade, colored: true },
    { label: 'Peak equity', money: dd.peak },
    { label: 'Max DD', money: dd.amount, colored: true },
    // A dash, not 0% — see the note in StatGrid; equity that never rose has no
    // peak to measure a fall against.
    { label: 'Max DD %', value: dd.pct === null ? '—' : `${dd.pct.toFixed(1)}%` },
    { label: 'Avg / trade', money: curveStats.expectancy, colored: true },
  ]

  return (
    <>
      <PageHeader eyebrow="Deep Dive" title="Analysis" />

      {/* Filters */}
      <div className="card" style={{ padding: 13, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 4, background: 'var(--card-2)', borderRadius: 10, padding: 3, overflowX: 'auto' }}>
          {PERIOD_KEYS.map((k) => (
            <button key={k} onClick={() => setPeriod(k)}
              style={{
                flex: 1, padding: '7px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap',
                background: period === k ? 'var(--card-hover)' : 'transparent',
                color: period === k ? 'var(--text)' : 'var(--text-3)',
              }}>{PERIODS[k].label}</button>
          ))}
        </div>

        <TagFilter trades={trades} selected={tags} onChange={setTags}
          mode={tagMode} onMode={setTagMode} />

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {TRADE_TYPE_KEYS.map((k) => (
            <button key={k} onClick={() => setTradeType(k)}
              style={{
                padding: '6px 13px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                border: `1px solid ${tradeType === k ? 'var(--mint)' : 'var(--stroke)'}`,
                color: tradeType === k ? 'var(--mint)' : 'var(--text-3)',
                background: tradeType === k ? 'rgba(47,212,138,0.09)' : 'transparent',
              }}>{TRADE_TYPES[k].label}</button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-3)' }}>
            {scoped.length} of {trades.length} trades
          </span>
        </div>
      </div>

      {trades.length === 0 ? (
        <Empty />
      ) : (
        <>
          {/* Headline */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 13, marginBottom: 16 }}>
            <Headline label="Total P&L" delay={0.02} money={a.totalPnl} colored
              sub={`${a.winCount}W / ${a.lossCount}L`} />
            <Headline label="Win Rate" delay={0.05} value={`${a.winRate.toFixed(1)}%`}
              sub={`${a.tradeCount} closed trade${a.tradeCount === 1 ? '' : 's'}`} />
            <Headline label="Profit Factor" delay={0.08}
              value={Number.isFinite(a.profitFactor) ? a.profitFactor.toFixed(2) : '∞'}
              sub={pf.label}
              subColor={pf.tone === 'good' ? 'var(--mint)' : pf.tone === 'bad' ? 'var(--red)' : 'var(--amber)'} />
            <Headline label="Expectancy" delay={0.11} money={a.expectancy} colored sub="per trade" />
          </div>

          <Panel title="Equity Curve" delay={0.14} style={{ marginBottom: 14 }}
            right={tradeType !== 'all' && (
              <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>all trades — the pill filter doesn’t apply here</span>
            )}>
            <EquityDrawdown trades={curveTrades} />
            <MetricStrip items={strip} />
          </Panel>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 14 }}>
            <Panel title="Win / Loss Distribution" delay={0.16}>
              <DistributionChart buckets={distribution} />
            </Panel>
            <Panel title="Long vs Short" delay={0.18}>
              <ComparisonBars rows={directions} emptyMessage="No trades carry a direction yet." />
            </Panel>
            <Panel title="Day of Week" delay={0.2}>
              <ComparisonBars rows={weekdays} />
            </Panel>
            <Panel title="Top Symbols" delay={0.22}>
              <ComparisonBars rows={symbols} labelKey="symbol" emptyMessage="No symbols in this period." />
            </Panel>
          </div>

          <Panel title="Session Performance" delay={0.24} style={{ marginBottom: 14 }}
            right={<span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>UTC</span>}>
            <SessionTimeline sessions={sessions} now={now} />
          </Panel>

          <Panel title="Trading Calendar" delay={0.26} style={{ marginBottom: 14 }}>
            <TradingCalendar trades={scoped} />
          </Panel>

          <Panel title="Tag Performance" delay={0.28} style={{ marginBottom: 14 }}
            right={<span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>within the filters above</span>}>
            <TagPerformance trades={scoped} />
          </Panel>

          {/* Hidden entirely rather than shown empty: an empty panel headed
              "What Mistakes Cost" reads as a broken widget, not as good news. */}
          {mistakes.trades > 0 && (
            <Panel title="What Mistakes Cost" delay={0.3} style={{ marginBottom: 14 }}>
              <MistakeSummary trades={scoped} />
            </Panel>
          )}

          <Panel title="Your Stats" delay={0.32}>
            <StatGrid a={a} months={months} />
          </Panel>
        </>
      )}
    </>
  )
}

function Headline({ label, value, money, colored, sub, subColor, delay = 0 }) {
  return (
    <motion.div className="card"
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay }}
      style={{ padding: '15px 17px' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{label}</div>
      <div className="mono" style={{ fontSize: 25, fontWeight: 700, marginTop: 6, letterSpacing: '-0.02em' }}>
        {/* Only money is masked. A win rate or a trade count gives away
            nothing about account size, and blurring it while the same figures
            sit unmasked in the breakdowns below just looks broken. */}
        {money !== undefined ? <Money value={money} digits={2} colored={colored} /> : value}
      </div>
      {sub && <div style={{ fontSize: 11, color: subColor || 'var(--text-3)', marginTop: 4 }}>{sub}</div>}
    </motion.div>
  )
}

function Empty() {
  return (
    <div className="card" style={{ padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 30, marginBottom: 10 }}>◑</div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Nothing to analyse yet</div>
      <div style={{ fontSize: 13, color: 'var(--text-3)', maxWidth: 420, margin: '0 auto', lineHeight: 1.6 }}>
        Log a few trades and this page fills in — equity curve, session breakdown,
        a calendar of every trading day, and the full stats block.
      </div>
    </div>
  )
}
