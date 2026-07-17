import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { PageHeader, Panel, RangeTabs } from '../components/common'
import { StatCard, StarRating } from '../components/widgets'
import { SessionBars } from '../components/charts'
import {
  filterByRange, computeStats, bySession, byKey, fmtMoney, fmtPct,
} from '../lib/stats'

export default function Analysis({ trades }) {
  const [range, setRange] = useState('month')
  const scoped = useMemo(() => filterByRange(trades, range), [trades, range])
  const s = useMemo(() => computeStats(scoped), [scoped])
  const sessions = useMemo(() => bySession(scoped), [scoped])
  const byStrat = useMemo(() => byKey(scoped, 'strategy'), [scoped])
  const bySymbol = useMemo(() => byKey(scoped, 'symbol'), [scoped])

  // rating distribution
  const ratingDist = useMemo(() => {
    const d = [1, 2, 3, 4, 5].map((r) => ({
      rating: r,
      count: scoped.filter((t) => t.rating === r).length,
    }))
    const max = Math.max(1, ...d.map((x) => x.count))
    return d.map((x) => ({ ...x, pct: (x.count / max) * 100 }))
  }, [scoped])

  return (
    <>
      <PageHeader eyebrow="Deep Dive" title="Analysis">
        <RangeTabs value={range} onChange={setRange} />
      </PageHeader>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 16 }}>
        <StatCard label="Net P&L" value={fmtMoney(s.netTotal)} accent={s.netTotal >= 0 ? 'var(--mint)' : 'var(--red)'} delay={0.02} />
        <StatCard label="Win Rate" value={fmtPct(s.winRate)} delay={0.05} />
        <StatCard label="Profit Factor" value={isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'} delay={0.08} />
        <StatCard label="Avg R:R" value={s.avgRR.toFixed(2)} delay={0.11} />
        <StatCard label="Expectancy" value={fmtMoney(s.expectancy)} accent={s.expectancy >= 0 ? 'var(--mint)' : 'var(--red)'} delay={0.14} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }} className="grid-2">
        <Panel title="Session Performance" delay={0.18}>
          {sessions.length ? <SessionBars data={sessions} /> : <Empty />}
        </Panel>
        <Panel title="Trade Rating Distribution" delay={0.22}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
            {ratingDist.map((r, i) => (
              <div key={r.rating} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 84 }}><StarRating value={r.rating} size={13} /></div>
                <div style={{ flex: 1, height: 12, background: '#141b1a', borderRadius: 6, overflow: 'hidden' }}>
                  <motion.div initial={{ width: 0 }} animate={{ width: `${r.pct}%` }} transition={{ delay: 0.3 + i * 0.06, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                    style={{ height: '100%', background: 'linear-gradient(90deg,#23b978,#3ee39a)', borderRadius: 6 }} />
                </div>
                <span className="mono" style={{ width: 28, textAlign: 'right', fontSize: 13, color: 'var(--text-2)' }}>{r.count}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }} className="grid-2">
        <Panel title="By Strategy" delay={0.26}><BreakdownTable rows={byStrat} /></Panel>
        <Panel title="By Symbol" delay={0.3}><BreakdownTable rows={bySymbol} /></Panel>
      </div>

      <style>{`@media (max-width: 900px) { .grid-2 { grid-template-columns: 1fr !important; } }`}</style>
    </>
  )
}

function BreakdownTable({ rows }) {
  if (!rows.length) return <Empty />
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>{['Name', 'Trades', 'Win %', 'Net P&L'].map((h) => (
          <th key={h} style={{ textAlign: h === 'Name' ? 'left' : 'right', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 600, padding: '0 8px 10px' }}>{h}</th>
        ))}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <motion.tr key={r.name} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
            style={{ borderTop: '1px solid var(--stroke-soft)' }}>
            <td style={{ padding: '11px 8px', fontWeight: 500 }}>{r.name}</td>
            <td style={{ padding: '11px 8px', textAlign: 'right', color: 'var(--text-2)', fontFamily: 'var(--mono)', fontSize: 13 }}>{r.count}</td>
            <td style={{ padding: '11px 8px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 13, color: r.winRate >= 50 ? 'var(--mint)' : 'var(--text-2)' }}>{r.winRate.toFixed(0)}%</td>
            <td style={{ padding: '11px 8px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: r.pnl >= 0 ? 'var(--mint)' : 'var(--red)' }}>{fmtMoney(r.pnl)}</td>
          </motion.tr>
        ))}
      </tbody>
    </table>
  )
}

function Empty() {
  return <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>No trades in this range</div>
}
