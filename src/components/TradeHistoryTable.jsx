import { useState } from 'react'
import { motion } from 'framer-motion'
import { net } from '../lib/stats'
import Money, { Amount } from './Money'
import { closeTime, openTime } from '../lib/analytics'
import { isSynced, sourceLabel, tradeSummaryText } from '../lib/accounts'
import { usePrefs } from '../lib/theme'
import { formatDateTime } from '../lib/format'
import { TagRow } from './TagPicker'

// The Trades page history table, laid out per the spec: stacked open/close
// timestamps, direction badge, prices, size, P&L, source, and row actions.
export default function TradeHistoryTable({ trades, onDelete, onEdit, unit = 'money' }) {
  const [copiedId, setCopiedId] = useState(null)
  // Timestamps render in the user's chosen timezone (Settings -> Timezone).
  const { timezone } = usePrefs()

  if (!trades.length) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
        No trades match the current filters.
      </div>
    )
  }

  const share = (trade) => {
    navigator.clipboard?.writeText(tradeSummaryText(trade)).then(() => {
      setCopiedId(trade.id)
      setTimeout(() => setCopiedId(null), 1600)
    })
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            {['Open / Close', 'Symbol', 'Type', 'Entry', 'Exit', 'Size', 'P&L', 'Source', ''].map((h) => (
              <th key={h} style={{
                fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em',
                color: 'var(--text-3)', fontWeight: 600, padding: '0 14px 12px', whiteSpace: 'nowrap',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => {
            const pnl = net(t)
            const synced = isSynced(t)
            const opened = openTime(t)
            const closed = closeTime(t)

            return (
              <motion.tr
                key={t.id}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.012, 0.25) }}
                style={{ borderTop: '1px solid var(--stroke-soft)' }}
              >
                <td style={cell}>
                  <div style={{ fontSize: 12.5 }}>{fmtStamp(opened, timezone)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {t.status === 'open' ? 'still open' : fmtStamp(closed, timezone)}
                  </div>
                </td>

                {/* Tags sit under the symbol rather than in a column of their
                    own: a tenth column would push the table's minimum width
                    past what a phone can show, and the symbol is what the eye
                    lands on anyway. */}
                <td style={{ ...cell, fontWeight: 600, fontFamily: 'var(--mono)' }}>
                  {t.symbol}
                  {Array.isArray(t.tags) && t.tags.length > 0 && (
                    <div style={{ marginTop: 5 }}><TagRow tags={t.tags} max={3} /></div>
                  )}
                </td>

                <td style={cell}>
                  <span style={{
                    fontSize: 11.5, padding: '3px 9px', borderRadius: 7, fontWeight: 600,
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    color: t.side === 'Long' ? 'var(--mint)' : 'var(--red)',
                    background: t.side === 'Long' ? 'rgba(47,212,138,0.1)' : 'rgba(255,107,107,0.1)',
                  }}>
                    {t.side === 'Long' ? '↑' : '↓'}{t.side}
                  </span>
                </td>

                <td style={{ ...cell, fontFamily: 'var(--mono)', fontSize: 13 }}>{t.entry ?? '—'}</td>
                <td style={{ ...cell, fontFamily: 'var(--mono)', fontSize: 13 }}>{t.exit ?? '—'}</td>
                <td style={{ ...cell, fontFamily: 'var(--mono)', fontSize: 13 }}>{t.qty ?? '—'}</td>

                <td style={{ ...cell, fontFamily: 'var(--mono)', fontSize: 13.5, fontWeight: 600 }}>
                  <Amount value={pnl} unit={unit} colored />
                </td>

                <td style={cell}>
                  <span style={{
                    fontSize: 10.5, padding: '3px 8px', borderRadius: 6,
                    border: '1px solid var(--stroke)', color: 'var(--text-2)',
                    background: 'var(--card-2)', whiteSpace: 'nowrap',
                  }}>{sourceLabel(t.source)}</span>
                </td>

                <td style={cell}>
                  <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                    <IconAction onClick={() => share(t)}
                      title={copiedId === t.id ? 'Copied' : 'Copy trade summary'}>
                      {copiedId === t.id ? '✓' : '⇗'}
                    </IconAction>
                    {onEdit && !synced && (
                      <IconAction onClick={() => onEdit(t)} title="Edit">✎</IconAction>
                    )}
                    {onDelete && (
                      <IconAction
                        onClick={synced ? undefined : () => onDelete(t.id)}
                        disabled={synced}
                        title={synced ? 'Synced trades cannot be deleted' : 'Delete'}
                      >✕</IconAction>
                    )}
                  </div>
                </td>
              </motion.tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function IconAction({ children, title, onClick, disabled }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled}
      style={{
        color: 'var(--text-3)', fontSize: 14, padding: '4px 6px', borderRadius: 6,
        opacity: disabled ? 0.35 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
      }}>{children}</button>
  )
}

function fmtStamp(ms, timezone) {
  if (ms === null) return '—'
  return formatDateTime(ms, { timezone })
}

const cell = { padding: '12px 14px', verticalAlign: 'middle', whiteSpace: 'nowrap' }
