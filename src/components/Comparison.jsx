import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import Money from './Money'
import { compare, fmtMinutes } from '../lib/comparison'

/**
 * Backtest against live — PRD §67.
 *
 * The layout puts the findings above the table on purpose. The table is
 * evidence; the findings are the answer, and a trader who reads only the top
 * of this panel should still leave with the right conclusion.
 */
export default function Comparison({ session, liveTrades, sessions = [], onPick }) {
  const btTrades = useMemo(() => (session?.trades || []).map(toRow), [session])
  const live = useMemo(() => scopeToSymbol(liveTrades, session?.symbol), [liveTrades, session])
  const result = useMemo(() => compare(btTrades, live), [btTrades, live])

  return (
    <>
      {sessions.length > 1 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 14 }}>
          {sessions.slice(0, 8).map((s) => {
            const on = s.id === session?.id
            return (
              <button key={s.id} onClick={() => onPick(s.id)}
                style={{
                  padding: '5px 11px', borderRadius: 20, fontSize: 11.5, fontWeight: 600,
                  border: `1px solid ${on ? 'var(--mint)' : 'var(--stroke)'}`,
                  color: on ? 'var(--mint)' : 'var(--text-3)',
                  background: on ? 'rgba(47,212,138,0.09)' : 'transparent',
                }}>{s.name} · {s.symbol}</button>
            )
          })}
        </div>
      )}

      <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 14 }}>
        {/* Stated up front, because a reader who assumes this covers all their
            trading will misread every row below it. */}
        Comparing <strong style={{ color: 'var(--text-2)' }}>{session?.name}</strong> against your
        live {session?.symbol} trades — {result.live.trades} of them.
        {session?.costs
          ? ' The backtest figures are net of the execution costs it was run with.'
          : ' This session was saved before execution costs were modelled, so its figures are gross — live trading will look worse than it is.'}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 18 }}>
        {result.findings.map((f, i) => <Finding key={f.kind} finding={f} delay={i * 0.04} />)}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 520, borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: 'var(--text-3)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <th style={{ textAlign: 'left', padding: '0 6px 8px 0', fontWeight: 600 }}>Metric</th>
              <th style={{ textAlign: 'right', padding: '0 10px 8px', fontWeight: 600 }}>Backtest</th>
              <th style={{ textAlign: 'right', padding: '0 10px 8px', fontWeight: 600 }}>Live</th>
              <th style={{ textAlign: 'right', padding: '0 0 8px 10px', fontWeight: 600 }}>Change</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.key} style={{ borderTop: '1px solid var(--stroke)' }}>
                <td style={{ padding: '9px 6px 9px 0' }}>
                  <div style={{ color: 'var(--text-2)' }}>{r.label}</div>
                  {r.evidence === 'insufficient' && (
                    <div style={{ fontSize: 10, color: 'var(--text-3)' }}>not enough trades to test</div>
                  )}
                  {r.evidence === 'significant' && (
                    <div style={{ fontSize: 10, color: 'var(--amber, #e8b13a)' }}>beyond chance</div>
                  )}
                </td>
                <td style={cellR}><Value row={r} which="backtest" /></td>
                <td style={cellR}><Value row={r} which="live" /></td>
                <td style={{ ...cellR, paddingRight: 0 }}><Change row={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 14, lineHeight: 1.6 }}>
        Totals are deliberately absent. A backtest over months and a live account over
        weeks differ in total by construction; only per-trade and per-day rates are
        comparable.
      </p>
    </>
  )
}

const cellR = { padding: '9px 10px', textAlign: 'right', fontFamily: 'var(--mono)' }

function Value({ row, which }) {
  const v = row[which]
  if (!Number.isFinite(v)) return <span style={{ color: 'var(--text-3)' }}>—</span>
  if (row.unit === 'money') return <Money value={v} />
  if (row.unit === 'minutes') return <span>{fmtMinutes(v)}</span>
  if (row.unit === '%') return <span>{v.toFixed(row.digits ?? 1)}%</span>
  if (row.unit === 'x') return <span>{Number.isFinite(v) ? `${v.toFixed(row.digits ?? 2)}×` : '∞'}</span>
  return <span>{v.toFixed(row.digits ?? 2)}</span>
}

function Change({ row }) {
  if (row.relative === null || !Number.isFinite(row.relative)) {
    return <span style={{ color: 'var(--text-3)' }}>—</span>
  }
  const colour = row.direction === 'worse' ? 'var(--red)'
    : row.direction === 'better' ? 'var(--mint)' : 'var(--text-3)'
  const sign = row.relative > 0 ? '+' : '−'
  return (
    <span style={{ color: colour }}>
      {sign}{Math.abs(row.relative * 100).toFixed(0)}%
    </span>
  )
}

function Finding({ finding, delay }) {
  const tone = {
    high: ['rgba(255,90,90,0.09)', 'rgba(255,90,90,0.3)', 'var(--red)'],
    medium: ['rgba(232,177,58,0.09)', 'rgba(232,177,58,0.28)', 'var(--amber, #e8b13a)'],
    low: ['var(--card-2)', 'var(--stroke)', 'var(--text-2)'],
    info: ['var(--card-2)', 'var(--stroke)', 'var(--text-3)'],
    good: ['rgba(62,227,154,0.09)', 'rgba(62,227,154,0.28)', 'var(--mint)'],
  }[finding.severity] || ['var(--card-2)', 'var(--stroke)', 'var(--text-2)']

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
      style={{
        padding: '11px 13px', borderRadius: 10,
        background: tone[0], border: `1px solid ${tone[1]}`,
      }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: tone[2] }}>{finding.title}</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.6 }}>
        {finding.detail}
      </div>
    </motion.div>
  )
}

/**
 * Live trades on the same instrument as the backtest.
 *
 * Comparing a EURUSD backtest against a book that is mostly gold would produce
 * a table of confident nonsense. If the symbol can't be matched the comparison
 * is refused rather than run against everything.
 */
function scopeToSymbol(trades, symbol) {
  if (!symbol) return []
  const want = String(symbol).toUpperCase()
  return (trades || []).filter((t) => String(t.symbol || '').toUpperCase() === want)
}

// Saved sessions hold the engine's own trade shape; the comparison wants the
// live-trade shape. Same mapping as backtest.js `toTradeRows`, applied to rows
// that have already been through JSON.
function toRow(t) {
  const closed = t.closedAt ?? t.closed_at
  const opened = t.openedAt ?? t.opened_at
  return {
    id: t.id,
    symbol: t.symbol,
    side: t.side,
    pnl: Number(t.pnl) || 0,
    fees: 0,
    opened_at: typeof opened === 'number' ? new Date(opened).toISOString() : opened,
    closed_at: typeof closed === 'number' ? new Date(closed).toISOString() : closed,
    traded_at: typeof closed === 'number' ? new Date(closed).toISOString() : closed,
  }
}

export { scopeToSymbol, toRow }
