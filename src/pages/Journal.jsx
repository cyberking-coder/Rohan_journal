import { useMemo, useState } from 'react'
import { PageHeader, Panel } from '../components/common'
import TradeTable from '../components/TradeTable'
import { StatCard } from '../components/widgets'
import { computeStats, fmtMoney, fmtPct } from '../lib/stats'

export default function Journal({ trades, onAdd, onDelete, onEdit }) {
  const [q, setQ] = useState('')
  const [side, setSide] = useState('All')

  const filtered = useMemo(() => {
    return trades.filter((t) => {
      if (side !== 'All' && t.side !== side) return false
      if (!q) return true
      const hay = `${t.symbol} ${t.strategy} ${t.session} ${t.notes || ''}`.toLowerCase()
      return hay.includes(q.toLowerCase())
    })
  }, [trades, q, side])

  const s = useMemo(() => computeStats(filtered), [filtered])

  return (
    <>
      <PageHeader eyebrow="Trade Log" title="Journal">
        <button onClick={onAdd} className="hide-mobile" style={{ padding: '10px 18px', borderRadius: 11, fontWeight: 600, fontSize: 14, background: 'linear-gradient(120deg,#3ee39a,#23b978)', color: '#04140d' }}>+ Add Trade</button>
      </PageHeader>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 16 }}>
        <StatCard label="Trades Shown" value={s.n} delay={0.02} />
        <StatCard label="Net P&L" value={fmtMoney(s.netTotal)} accent={s.netTotal >= 0 ? 'var(--mint)' : 'var(--red)'} delay={0.06} />
        <StatCard label="Win Rate" value={fmtPct(s.winRate)} delay={0.1} />
        <StatCard label="Profit Factor" value={isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'} delay={0.14} />
      </div>

      <Panel delay={0.18}
        title="All Trades"
        right={
          <div style={{ display: 'flex', gap: 10 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
              style={{ background: 'var(--input-bg)', border: '1px solid var(--stroke)', color: 'var(--text)', borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none', width: 170 }} />
            <select value={side} onChange={(e) => setSide(e.target.value)}
              style={{ background: 'var(--input-bg)', border: '1px solid var(--stroke)', color: 'var(--text)', borderRadius: 10, padding: '8px 12px', fontSize: 13 }}>
              <option>All</option><option>Long</option><option>Short</option>
            </select>
          </div>
        }
      >
        <TradeTable trades={filtered} onDelete={onDelete} onEdit={onEdit} />
      </Panel>
    </>
  )
}
