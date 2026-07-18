import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { PageHeader, Panel, RangeTabs } from '../components/common'
import { StatCard, StarRating } from '../components/widgets'
import { SessionBars } from '../components/charts'
import {
  filterByRange, computeStats, bySession, byKey, fmtMoney, fmtPct,
  buildInsights, biggestTrades, net,
} from '../lib/stats'

export default function Analysis({ trades }) {
  const [range, setRange] = useState('month')
  const [strategy, setStrategy] = useState('All')

  const strategyOptions = useMemo(
    () => ['All', ...Array.from(new Set(trades.map((t) => t.strategy).filter(Boolean)))],
    [trades]
  )

  const scoped = useMemo(() => {
    const inRange = filterByRange(trades, range)
    return strategy === 'All' ? inRange : inRange.filter((t) => t.strategy === strategy)
  }, [trades, range, strategy])
  const s = useMemo(() => computeStats(scoped), [scoped])
  const sessions = useMemo(() => bySession(scoped), [scoped])
  const byStrat = useMemo(() => byKey(scoped, 'strategy'), [scoped])
  const bySymbol = useMemo(() => byKey(scoped, 'symbol'), [scoped])
  const insights = useMemo(() => buildInsights(scoped), [scoped])
  const { win, loss } = useMemo(() => biggestTrades(scoped), [scoped])

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
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)}
            style={{ background: 'var(--card)', border: '1px solid var(--stroke)', color: 'var(--text)', borderRadius: 11, padding: '9px 12px', fontSize: 13, maxWidth: 230 }}>
            {strategyOptions.map((o) => <option key={o} value={o}>{o === 'All' ? 'All strategies' : o}</option>)}
          </select>
          <RangeTabs value={range} onChange={setRange} />
        </div>
      </PageHeader>
      {strategy !== 'All' && (
        <div style={{ marginBottom: 14, fontSize: 12.5, color: 'var(--text-3)' }}>
          Filtered to <span style={{ color: 'var(--mint)' }}>{strategy}</span> · {scoped.length} trade{scoped.length === 1 ? '' : 's'}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 16 }}>
        <StatCard label="Net P&L" value={fmtMoney(s.netTotal)} accent={s.netTotal >= 0 ? 'var(--mint)' : 'var(--red)'} delay={0.02} />
        <StatCard label="Win Rate" value={fmtPct(s.winRate)} delay={0.05} />
        <StatCard label="Profit Factor" value={isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'} delay={0.08} />
        <StatCard label="Avg R:R" value={s.avgRR.toFixed(2)} delay={0.11} />
        <StatCard label="Expectancy" value={fmtMoney(s.expectancy)} accent={s.expectancy >= 0 ? 'var(--mint)' : 'var(--red)'} delay={0.14} />
      </div>

      {/* Coaching insights */}
      <Panel title="Coaching Insights" delay={0.16} right={<span style={{ fontSize: 12, color: 'var(--text-3)' }}>Generated from your trades</span>} style={{ marginBottom: 14 }}>
        {insights.note ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13.5 }}>{insights.note}</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            <InsightColumn title="Keep doing" icon="✓" color="var(--mint)" items={insights.keep} empty="Build a positive edge to see what's working." />
            <InsightColumn title="Do more of" icon="▲" color="#8be0ff" items={insights.strengths} empty="No standout strengths yet." />
            <InsightColumn title="Where to improve" icon="!" color="var(--amber)" items={insights.improvements} empty="Nothing is clearly hurting you — nice." />
          </div>
        )}
      </Panel>

      {/* Biggest win / loss */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }} className="grid-2">
        <ExtremeTrade label="Biggest Win" trade={win} positive delay={0.2} />
        <ExtremeTrade label="Biggest Loss" trade={loss} delay={0.24} />
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

function renderBold(text) {
  // turns **word** into a highlighted span
  return text.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) =>
    chunk.startsWith('**') && chunk.endsWith('**')
      ? <span key={i} style={{ color: 'var(--text)', fontWeight: 600 }}>{chunk.slice(2, -2)}</span>
      : <span key={i}>{chunk}</span>
  )
}

function InsightColumn({ title, icon, color, items, empty }) {
  return (
    <div style={{ background: '#0e1413', border: '1px solid var(--stroke)', borderRadius: 14, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700, color: '#04140d', background: color,
        }}>{icon}</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color }}>{title}</span>
      </div>
      {items && items.length ? (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 11 }}>
          {items.map((t, i) => (
            <motion.li key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.06 }}
              style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)', display: 'flex', gap: 8 }}>
              <span style={{ color, marginTop: 1 }}>•</span>
              <span>{renderBold(t)}</span>
            </motion.li>
          ))}
        </ul>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{empty}</div>
      )}
    </div>
  )
}

function ExtremeTrade({ label, trade, positive, delay }) {
  const color = positive ? 'var(--mint)' : 'var(--red)'
  return (
    <Panel title={label} delay={delay}>
      {trade ? (
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 30, fontWeight: 700, color, letterSpacing: '-0.02em' }}>
            {fmtMoney(net(trade))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13, color: 'var(--text-2)' }}>
            <span><b style={{ color: 'var(--text)', fontFamily: 'var(--mono)' }}>{trade.symbol}</b> · {trade.side}</span>
            <span>{trade.strategy}</span>
            <span style={{ color: 'var(--text-3)' }}>{trade.session} · {new Date(trade.traded_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </div>
          {trade.screenshot_url && (
            <a href={trade.screenshot_url} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto' }}>
              <img src={trade.screenshot_url} alt="chart" referrerPolicy="no-referrer"
                style={{ width: 88, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--stroke)' }} />
            </a>
          )}
        </div>
      ) : (
        <div style={{ padding: '18px 0', color: 'var(--text-3)', fontSize: 13 }}>
          No {positive ? 'winning' : 'losing'} trades in this range.
        </div>
      )}
    </Panel>
  )
}

function Empty() {
  return <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>No trades in this range</div>
}
