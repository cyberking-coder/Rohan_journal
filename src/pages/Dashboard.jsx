import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { PageHeader, Panel } from '../components/common'
import { DonutGauge, HexStat, MiniStat } from '../components/widgets'
import Money, { Sensitive } from '../components/Money'
import PerformanceChart from '../components/PerformanceChart'
import NewsTicker from '../components/NewsTicker'
import { PnlBars, SessionBars } from '../components/charts'
import HeatmapCalendar from '../components/HeatmapCalendar'
import {
  cumulativeEquity, filterTrades, monthlyTotals, realisedSplit,
} from '../lib/analytics'
import {
  computeStats, dailyPnl, bySession, buildInsights, fmtMoney, fmtPct, fmtRR, net,
} from '../lib/stats'
import { usePrefs } from '../lib/theme'
import { formatMoney, formatMoneyCompact } from '../lib/format'

// The spec's dashboard period tabs. They map onto the same cutoffs the
// analytics core already understands.
const PERIODS = [
  { key: 'today', label: '1D' },
  { key: '7d', label: '1W' },
  { key: '30d', label: '1M' },
  { key: '3m', label: '3M' },
  { key: 'all', label: 'ALL' },
]

export default function Dashboard({ trades, onAdd }) {
  const [period, setPeriod] = useState('30d')
  const { currency } = usePrefs()

  const scoped = useMemo(() => filterTrades(trades, { period }), [trades, period])
  const s = useMemo(() => computeStats(scoped), [scoped])
  const split = useMemo(() => realisedSplit(trades), [trades])
  const months = useMemo(() => monthlyTotals(trades), [trades])
  const bars = useMemo(() => dailyPnl(trades, 30), [trades])
  const sessions = useMemo(() => bySession(scoped), [scoped])
  const insights = useMemo(() => buildInsights(scoped), [scoped])

  // Cumulative equity across the selected period, labelled for the chart.
  const curve = useMemo(() => cumulativeEquity(scoped).map((p, i) => ({
    i,
    label: p.at ? new Date(p.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '',
    equity: Math.round(p.equity * 100) / 100,
  })), [scoped])

  const periodPnl = curve.length ? curve[curve.length - 1].equity : 0

  return (
    <>
      <PageHeader eyebrow="Overview" title="Dashboard">
        <div className="page-controls" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 3, padding: 3, background: 'var(--card)', border: '1px solid var(--stroke)', borderRadius: 11 }}>
            {PERIODS.map((p) => (
              <button key={p.key} onClick={() => setPeriod(p.key)}
                style={{
                  padding: '7px 13px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                  background: period === p.key ? 'linear-gradient(120deg,#3ee39a,#23b978)' : 'transparent',
                  color: period === p.key ? '#04140d' : 'var(--text-3)',
                }}>{p.label}</button>
            ))}
          </div>
          <button onClick={onAdd} className="hide-mobile"
            style={{ padding: '9px 16px', borderRadius: 11, fontWeight: 600, fontSize: 13, background: 'linear-gradient(120deg,#3ee39a,#23b978)', color: '#04140d' }}>+ Add</button>
        </div>
      </PageHeader>

      {/* ── The spec's four headline cards ───────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 14 }}>
        <HeadlineCard
          label="Total P&L" delay={0.02}
          value={<Money value={s.netTotal} colored />}
          sub={`${s.n} ${s.n === 1 ? 'trade' : 'trades'} in period`}
        />
        <HeadlineCard
          label="Unrealized" delay={0.06}
          value={<Money value={split.unrealised} colored={split.openCount > 0} />}
          sub={`${split.openCount} open ${split.openCount === 1 ? 'position' : 'positions'}`}
          muted={split.openCount === 0}
        />
        <HeadlineCard
          label="Realized" delay={0.1}
          value={<Money value={split.realised} colored />}
          sub={`${split.closedCount} closed ${split.closedCount === 1 ? 'trade' : 'trades'}`}
        />
        <HeadlineCard
          label="Win Rate" delay={0.14}
          value={<span className="mono" style={{ fontSize: 26, fontWeight: 600 }}>{fmtPct(s.winRate, 1)}</span>}
          sub={`${s.wins} wins · ${s.losses} losses`}
        >
          <div style={{ height: 5, borderRadius: 3, background: 'var(--track)', overflow: 'hidden', marginTop: 8 }}>
            <motion.div
              initial={{ width: 0 }} animate={{ width: `${Math.min(100, s.winRate)}%` }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              style={{ height: '100%', background: 'linear-gradient(90deg,#23b978,#3ee39a)' }} />
          </div>
        </HeadlineCard>
      </div>

      {/* ── Performance chart ────────────────────────────────────────── */}
      <Panel
        delay={0.18}
        title="Performance"
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sensitive className="mono" style={{ fontSize: 15, fontWeight: 700, color: periodPnl >= 0 ? 'var(--mint)' : 'var(--red)' }}>
              {formatMoney(periodPnl, { currency })}
            </Sensitive>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '3px 7px', borderRadius: 5,
              color: periodPnl >= 0 ? 'var(--mint)' : 'var(--red)',
              border: `1px solid ${periodPnl >= 0 ? 'rgba(47,212,138,0.35)' : 'rgba(255,107,107,0.35)'}`,
            }}>{periodPnl >= 0 ? '▲' : '▼'} {PERIODS.find((p) => p.key === period)?.label}</span>
          </div>
        }
        style={{ marginBottom: 14 }}
      >
        <PerformanceChart data={curve} positive={periodPnl >= 0} />
      </Panel>

      {/* ── Monthly P&L strip ────────────────────────────────────────── */}
      <Panel title="Monthly P&L" delay={0.22} style={{ marginBottom: 14 }}
        right={<span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>All time</span>}>
        <MonthlyStrip months={months} currency={currency} />
      </Panel>

      {/* ── Coaching banner ──────────────────────────────────────────── */}
      {!insights.note && <TopInsight insights={insights} />}

      {/* ── Existing detail widgets ──────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.2fr 1.4fr', gap: 14, marginBottom: 14 }} className="grid-3">
        <Panel title="Win Rate" delay={0.26} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <DonutGauge value={s.winRate} />
          <div style={{ display: 'flex', gap: 22, marginTop: 16 }}>
            <div style={{ textAlign: 'center' }}>
              <div className="mono pos" style={{ fontSize: 18, fontWeight: 600 }}>{s.wins}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Wins</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div className="mono neg" style={{ fontSize: 18, fontWeight: 600 }}>{s.losses}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Losses</div>
            </div>
          </div>
        </Panel>

        <Panel title="Risk / Reward" delay={0.3} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
            <HexStat value={fmtRR(s.avgRR)} label="Avg R:R" delay={0.34} />
            <HexStat value={isFinite(s.profitFactor) ? s.profitFactor.toFixed(1) : '∞'} label="Profit Factor" delay={0.4} />
          </div>
        </Panel>

        <Panel title="Wins × Losses" delay={0.34}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <MiniStat icon="▦" label="Trades" value={s.n} />
            <MiniStat icon="★" label="Avg Rating" value={s.avgRating ? `${s.avgRating.toFixed(1)}/10` : '—'} accent="var(--amber)" />
            <MiniStat icon="↑" label="Avg Win" value={<Money value={s.avgWin} digits={0} />} accent="var(--mint)" />
            <MiniStat icon="↓" label="Avg Loss" value={<Money value={-s.avgLoss} digits={0} />} accent="var(--red)" />
            <MiniStat icon="✦" label="Best" value={<Money value={s.bestTrade} digits={0} />} accent="var(--mint)" />
            <MiniStat icon="✕" label="Worst" value={<Money value={s.worstTrade} digits={0} />} accent="var(--red)" />
          </div>
        </Panel>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 14 }} className="grid-2">
        <Panel title="Performance Calendar" delay={0.38}
          right={<span style={{ fontSize: 12, color: 'var(--text-3)' }}>Last ~19 weeks</span>}>
          <HeatmapCalendar trades={trades} />
        </Panel>
        <Panel title="P&L · Last 30 Days" delay={0.42}>
          <PnlBars data={bars} />
        </Panel>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14, marginTop: 14 }}>
        <Panel title="Session Performance" delay={0.46}>
          {sessions.length ? <SessionBars data={sessions} /> : <Empty />}
        </Panel>
      </div>

      <NewsTicker />

      <style>{`
        @media (max-width: 1080px) { .grid-3 { grid-template-columns: 1fr !important; } }
        @media (max-width: 900px) { .grid-2 { grid-template-columns: 1fr !important; } }
      `}</style>
    </>
  )
}

function HeadlineCard({ label, value, sub, delay = 0, muted, children }) {
  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3 }}
      style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <span className="eyebrow">{label}</span>
      <span className="mono" style={{
        fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em',
        color: muted ? 'var(--text-3)' : undefined,
      }}>{value}</span>
      {sub && <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{sub}</span>}
      {children}
    </motion.div>
  )
}

function MonthlyStrip({ months, currency }) {
  if (!months.length) {
    return <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>No closed trades yet.</div>
  }
  const peak = Math.max(...months.map((m) => Math.abs(m.pnl)), 1)

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', overflowX: 'auto', paddingBottom: 4 }}>
      {months.map((m, i) => {
        const positive = m.pnl >= 0
        return (
          <div key={m.key} style={{ flex: '1 0 62px', minWidth: 62, textAlign: 'center' }}>
            <Sensitive className="mono" style={{
              display: 'block', fontSize: 11.5, fontWeight: 600, marginBottom: 6,
              color: positive ? 'var(--mint)' : 'var(--red)',
            }}>{formatMoneyCompact(m.pnl, { currency })}</Sensitive>
            <div style={{ height: 84, display: 'flex', alignItems: 'flex-end' }}>
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(4, (Math.abs(m.pnl) / peak) * 100)}%` }}
                transition={{ delay: 0.1 + i * 0.05, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  width: '100%', borderRadius: 6,
                  background: positive
                    ? 'linear-gradient(180deg,#3ee39a,#23b978)'
                    : 'linear-gradient(180deg,#ff8b8b,#d64545)',
                }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 7 }}>{m.label}</div>
            <div style={{ fontSize: 9.5, color: 'var(--text-3)' }}>{m.count} trades</div>
          </div>
        )
      })}
    </div>
  )
}

function boldText(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((c, i) =>
    c.startsWith('**') && c.endsWith('**')
      ? <span key={i} style={{ color: 'var(--text)', fontWeight: 600 }}>{c.slice(2, -2)}</span>
      : <span key={i}>{c}</span>
  )
}

function TopInsight({ insights }) {
  const strength = insights.strengths[0] || insights.keep[0]
  const improve = insights.improvements[0]
  if (!strength && !improve) return null
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.24 }}
      className="card"
      style={{ padding: '16px 20px', marginBottom: 14, display: 'grid', gridTemplateColumns: strength && improve ? '1fr 1fr' : '1fr', gap: 18 }}
    >
      {strength && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 8, background: 'var(--mint)', color: '#04140d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>✓</span>
          <div>
            <div className="eyebrow" style={{ color: 'var(--mint)', marginBottom: 3 }}>Your edge</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-2)' }}>{boldText(strength)}</div>
          </div>
        </div>
      )}
      {improve && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', borderLeft: strength ? '1px solid var(--stroke)' : 'none', paddingLeft: strength ? 18 : 0 }}>
          <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 8, background: 'var(--amber)', color: '#04140d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>!</span>
          <div>
            <div className="eyebrow" style={{ color: 'var(--amber)', marginBottom: 3 }}>Fix this</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--text-2)' }}>{boldText(improve)}</div>
          </div>
        </div>
      )}
    </motion.div>
  )
}

function Empty() {
  return <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>No data in range</div>
}
