import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { net, fmtMoney } from '../lib/stats'
import { StarRating, PnlPill } from './widgets'

export default function TradeTable({ trades, onDelete }) {
  const [lightbox, setLightbox] = useState(null)
  const rows = [...trades].sort((a, b) => new Date(b.traded_at) - new Date(a.traded_at))

  if (!rows.length) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-3)' }}>
        No trades yet — log your first one.
      </div>
    )
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            {['Date', 'Symbol', 'Side', 'Strategy', 'Session', 'R:R', 'Rating', 'Chart', 'Net P&L', ''].map((h) => (
              <th key={h} style={{
                fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em',
                color: 'var(--text-3)', fontWeight: 600, padding: '0 14px 12px', whiteSpace: 'nowrap',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <motion.tr
              key={t.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.015, 0.3) }}
              style={{ borderTop: '1px solid var(--stroke-soft)' }}
            >
              <td style={cell}>
                <div style={{ fontSize: 13 }}>{new Date(t.traded_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{new Date(t.traded_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</div>
              </td>
              <td style={{ ...cell, fontWeight: 600, fontFamily: 'var(--mono)' }}>{t.symbol}</td>
              <td style={cell}>
                <span style={{
                  fontSize: 11.5, padding: '3px 9px', borderRadius: 7, fontWeight: 600,
                  color: t.side === 'Long' ? 'var(--mint)' : 'var(--red)',
                  background: t.side === 'Long' ? 'rgba(47,212,138,0.1)' : 'rgba(255,107,107,0.1)',
                }}>{t.side}</span>
              </td>
              <td style={{ ...cell, color: 'var(--text-2)', fontSize: 13 }}>{t.strategy}</td>
              <td style={{ ...cell, color: 'var(--text-2)', fontSize: 13 }}>{t.session}</td>
              <td style={{ ...cell, fontFamily: 'var(--mono)', fontSize: 13 }}>{Number(t.rr || 0).toFixed(2)}</td>
              <td style={cell}><StarRating value={t.rating} size={13} /></td>
              <td style={cell}>
                {t.screenshot_url ? (
                  <button onClick={() => setLightbox(t.screenshot_url)} title="View chart"
                    style={{ display: 'block', width: 40, height: 28, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--stroke)' }}>
                    <img src={t.screenshot_url} alt="chart" referrerPolicy="no-referrer"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </button>
                ) : (
                  <span style={{ color: 'var(--text-3)', fontSize: 13 }}>—</span>
                )}
              </td>
              <td style={cell}><PnlPill value={net(t)} /></td>
              <td style={cell}>
                {onDelete && (
                  <button onClick={() => onDelete(t.id)} title="Delete"
                    style={{ color: 'var(--text-3)', fontSize: 15, padding: 4 }}>✕</button>
                )}
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>

      <AnimatePresence>
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
            style={{
              position: 'fixed', inset: 0, zIndex: 60, padding: 30,
              background: 'rgba(4,7,6,0.85)', backdropFilter: 'blur(6px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <motion.img
              src={lightbox} alt="trade chart" referrerPolicy="no-referrer"
              initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: '92vw', maxHeight: '88vh', borderRadius: 12, border: '1px solid var(--stroke)', boxShadow: 'var(--shadow)' }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const cell = { padding: '13px 14px', verticalAlign: 'middle', whiteSpace: 'nowrap' }
