import { useMemo, useState } from 'react'
import { PageHeader, Panel, RangeTabs } from '../components/common'
import { StatCard, DonutGauge, HexStat, MiniStat } from '../components/widgets'
import { EquityCurve, PnlBars, SessionBars } from '../components/charts'
import HeatmapCalendar from '../components/HeatmapCalendar'
import {
  filterByRange, computeStats, equityCurve, dailyPnl, bySession, fmtMoney, fmtPct,
} from '../lib/stats'

export default function Dashboard({ trades, onAdd }) {
  const [range, setRange] = useState('quarter')
  const scoped = useMemo(() => filterByRange(trades, range), [trades, range])
  const s = useMemo(() => computeStats(scoped), [scoped])
  const curve = useMemo(() => equityCurve(scoped), [scoped])
  const bars = useMemo(() => dailyPnl(trades, 30), [trades])
  const sessions = useMemo(() => bySession(scoped), [scoped])

  return (
    <>
      <PageHeader eyebrow="Overview" title="Dashboard">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <RangeTabs value={range} onChange={setRange} />
          <button onClick={onAdd} style={{ padding: '9px 16px', borderRadius: 11, fontWeight: 600, fontSize: 13, background: 'linear-gradient(120deg,#3ee39a,#23b978)', color: '#04140d' }}>+ Add</button>
        </div>
      </PageHeader>

      {/* Top stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 14 }}>
        <StatCard label="Total Gross" value={fmtMoney(s.gross)} sub={`${s.n} trades`} delay={0.02} />
        <StatCard label="Total Net" value={fmtMoney(s.netTotal)} accent={s.netTotal >= 0 ? 'var(--mint)' : 'var(--red)'} sub={`Commission ${fmtMoney(s.fees)}`} delay={0.06} />
        <StatCard label="Expectancy / trade" value={fmtMoney(s.expectancy, 0)} accent={s.expectancy >= 0 ? 'var(--mint)' : 'var(--red)'} sub={`Avg R:R ${s.avgRR.toFixed(2)}`} delay={0.1} />
        <StatCard label="Commissions" value={fmtMoney(s.fees)} sub="Total commission paid" delay={0.14} />
      </div>

      {/* Win rate + risk reward + wins/losses row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.2fr 1.4fr', gap: 14, marginBottom: 14 }} className="grid-3">
        <Panel title="Win Rate" delay={0.16} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
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

        <Panel title="Risk / Reward" delay={0.2} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
            <HexStat value={s.avgRR.toFixed(1)} label="Avg R:R" delay={0.3} />
            <HexStat value={isFinite(s.profitFactor) ? s.profitFactor.toFixed(1) : '∞'} label="Profit Factor" delay={0.4} />
          </div>
        </Panel>

        <Panel title="Wins × Losses" delay={0.24}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <MiniStat icon="▦" label="Trades" value={s.n} />
            <MiniStat icon="★" label="Avg Rating" value={s.avgRating.toFixed(1)} accent="var(--amber)" />
            <MiniStat icon="↑" label="Avg Win" value={fmtMoney(s.avgWin)} accent="var(--mint)" />
            <MiniStat icon="↓" label="Avg Loss" value={fmtMoney(-s.avgLoss)} accent="var(--red)" />
            <MiniStat icon="✦" label="Best" value={fmtMoney(s.bestTrade)} accent="var(--mint)" />
            <MiniStat icon="✕" label="Worst" value={fmtMoney(s.worstTrade)} accent="var(--red)" />
          </div>
        </Panel>
      </div>

      {/* Equity + P&L 30d */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14, marginBottom: 14 }} className="grid-2">
        <Panel title="Equity Curve" delay={0.28}
          right={<Legend items={[['Net', 'var(--mint)'], ['Gross', '#c9d3ce']]} />}>
          <EquityCurve data={curve} />
        </Panel>
        <Panel title="P&L · Last 30 Days" delay={0.32}>
          <PnlBars data={bars} />
        </Panel>
      </div>

      {/* Heatmap + sessions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 14 }} className="grid-2">
        <Panel title="Performance Calendar" delay={0.36} right={<span style={{ fontSize: 12, color: 'var(--text-3)' }}>Last ~19 weeks</span>}>
          <HeatmapCalendar trades={trades} />
        </Panel>
        <Panel title="Session Performance" delay={0.4}>
          {sessions.length ? <SessionBars data={sessions} /> : <Empty />}
        </Panel>
      </div>

      <style>{`
        @media (max-width: 1080px) { .grid-3 { grid-template-columns: 1fr !important; } }
        @media (max-width: 900px) { .grid-2 { grid-template-columns: 1fr !important; } }
      `}</style>
    </>
  )
}

function Legend({ items }) {
  return (
    <div style={{ display: 'flex', gap: 14 }}>
      {items.map(([l, c]) => (
        <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
          <span style={{ width: 10, height: 3, borderRadius: 2, background: c }} />{l}
        </span>
      ))}
    </div>
  )
}

function Empty() {
  return <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>No data in range</div>
}
