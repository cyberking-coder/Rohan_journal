import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { calendarData, fmtMoney } from '../lib/stats'

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function color(pnl, max) {
  if (pnl === 0) return '#141b1a'
  const t = Math.min(1, Math.abs(pnl) / (max || 1))
  if (pnl > 0) {
    // mint scale
    const a = 0.18 + t * 0.82
    return `rgba(47, 212, 138, ${a})`
  }
  const a = 0.18 + t * 0.82
  return `rgba(255, 107, 107, ${a})`
}

export default function HeatmapCalendar({ trades, days = 133 }) {
  const [hover, setHover] = useState(null)
  const cells = useMemo(() => calendarData(trades, days), [trades, days])
  const max = useMemo(() => Math.max(1, ...cells.map((c) => Math.abs(c.pnl))), [cells])

  // pad so the first column starts on Sunday
  const pad = cells.length ? cells[0].dow : 0
  const padded = [...Array(pad).fill(null), ...cells]
  const weeks = []
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 2 }}>
          {DOW.map((d, i) => (
            <span key={i} style={{ height: 15, fontSize: 9.5, color: 'var(--text-3)', lineHeight: '15px' }}>{i % 2 ? d : ''}</span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {week.map((cell, di) =>
                cell === null ? (
                  <div key={di} style={{ width: 15, height: 15 }} />
                ) : (
                  <motion.div
                    key={di}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: (wi * 7 + di) * 0.002, duration: 0.25 }}
                    onMouseEnter={() => setHover(cell)}
                    onMouseLeave={() => setHover(null)}
                    style={{
                      width: 15, height: 15, borderRadius: 4,
                      background: color(cell.pnl, max),
                      border: '1px solid rgba(255,255,255,0.04)',
                      cursor: 'default',
                    }}
                  />
                )
              )}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-2)', minHeight: 18 }}>
          {hover ? (
            <span>
              <span style={{ color: 'var(--text-3)' }}>{hover.date}</span>
              {'  ·  '}
              <span style={{ color: hover.pnl >= 0 ? 'var(--mint)' : 'var(--red)' }}>{fmtMoney(hover.pnl)}</span>
              {'  ·  '}
              {hover.count} trade{hover.count === 1 ? '' : 's'}
            </span>
          ) : (
            <span style={{ color: 'var(--text-3)' }}>Hover a day to inspect P&amp;L</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--text-3)' }}>
          Loss
          <span style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(255,107,107,0.85)' }} />
          <span style={{ width: 12, height: 12, borderRadius: 3, background: '#141b1a' }} />
          <span style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(47,212,138,0.85)' }} />
          Profit
        </div>
      </div>
    </div>
  )
}
