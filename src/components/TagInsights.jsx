import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import Money from './Money'
import { Chip, colorFor } from './TagPicker'
import { MATCH_MODES, byCategory, mistakeCost, tagPerformance, usedTags } from '../lib/tags'

/**
 * The tag filter bar for the Analysis page.
 *
 * Shows only tags the user has actually used. Offering the full catalogue here
 * would fill the page with thirty filters that all return nothing.
 */
export function TagFilter({ trades, selected, onChange, mode, onMode }) {
  const available = useMemo(() => usedTags(trades), [trades])
  const [expanded, setExpanded] = useState(false)

  if (!available.length) return null

  const shown = expanded ? available : available.slice(0, 12)
  const toggle = (slug) => onChange(
    selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug],
  )

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {shown.map((t) => {
        const on = selected.includes(t.slug)
        const c = colorFor(t.category)
        return (
          <button key={t.slug} onClick={() => toggle(t.slug)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              borderRadius: 20, padding: '5px 11px', fontSize: 11.5, fontWeight: 500,
              border: `1px solid ${on ? c.fg : c.line}`,
              background: on ? c.bg : 'transparent',
              color: on ? c.fg : 'var(--text-3)',
            }}>
            {t.label}
            <span style={{ opacity: 0.55, fontSize: 10 }}>{t.count}</span>
          </button>
        )
      })}

      {available.length > 12 && (
        <button onClick={() => setExpanded((v) => !v)} style={{ fontSize: 11, color: 'var(--text-3)' }}>
          {expanded ? 'fewer' : `+${available.length - 12} more`}
        </button>
      )}

      {/* Any/all only appears once it can change the answer. */}
      {selected.length > 1 && (
        <div style={{ display: 'flex', gap: 3, background: 'var(--card-2)', borderRadius: 8, padding: 2, marginLeft: 4 }}>
          {Object.entries(MATCH_MODES).map(([k, v]) => (
            <button key={k} onClick={() => onMode(k)} title={v.hint}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                background: mode === k ? 'var(--card-hover)' : 'transparent',
                color: mode === k ? 'var(--text)' : 'var(--text-3)',
              }}>{v.label}</button>
          ))}
        </div>
      )}

      {selected.length > 0 && (
        <button onClick={() => onChange([])} style={{ fontSize: 11, color: 'var(--text-3)' }}>clear</button>
      )}
    </div>
  )
}

/**
 * Performance by tag.
 *
 * The `minTrades` control is not a nicety. Left at 1, the top row of this table
 * is reliably a tag used twice that happened to win twice, and a trader will
 * read that as a finding. Defaulting to 3 costs a little completeness and
 * removes most of the noise; the control makes the trade-off visible instead
 * of hiding it.
 */
export function TagPerformance({ trades }) {
  const [minTrades, setMinTrades] = useState(3)
  const rows = useMemo(() => tagPerformance(trades, { minTrades }), [trades, minTrades])
  const concepts = byCategory(rows, 'concept').concat(byCategory(rows, 'custom'))
  const mistakes = byCategory(rows, 'mistake')

  const totalTagged = useMemo(() => tagPerformance(trades, { minTrades: 1 }).length, [trades])

  if (!totalTagged) {
    return (
      <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.7, maxWidth: 520 }}>
        No tags yet. Tag a few trades with what you saw — FVG, liquidity sweep, order
        block — and what went wrong, and this table will tell you which of them
        actually make money.
      </p>
    )
  }

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
        fontSize: 11.5, color: 'var(--text-3)', flexWrap: 'wrap',
      }}>
        <span>Hide tags with fewer than</span>
        {[1, 3, 5, 10].map((n) => (
          <button key={n} onClick={() => setMinTrades(n)}
            style={{
              padding: '3px 9px', borderRadius: 7, fontSize: 11, fontWeight: 600,
              background: minTrades === n ? 'var(--card-hover)' : 'var(--card-2)',
              color: minTrades === n ? 'var(--text)' : 'var(--text-3)',
            }}>{n}</button>
        ))}
        <span>trades</span>
        {/* Clickable, because in a young journal the default threshold can
            hide nearly everything, and a passive "7 tags hidden" leaves the
            reader to work out that the row of numbers above is the way back. */}
        {rows.length < totalTagged && (
          <button onClick={() => setMinTrades(1)} style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-3)', textDecoration: 'underline' }}>
            {totalTagged - rows.length} tag{totalTagged - rows.length === 1 ? '' : 's'} hidden — show all
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
          No tag has {minTrades} trades yet. Lower the threshold to see the rest.
        </p>
      ) : (
        <>
          <Table title="What you saw" rows={concepts} empty="No concept tags yet." />
          {mistakes.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <Table title="What went wrong" rows={mistakes} />
            </div>
          )}
        </>
      )}

      {/* Said once, because a reader who takes these rows for a breakdown of
          total P&L will draw confident and wrong conclusions from them. */}
      <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 16, lineHeight: 1.6 }}>
        A trade counts toward every tag it carries, so these rows overlap and do not
        add up to your total P&L.
      </p>
    </>
  )
}

function Table({ title, rows, empty }) {
  if (!rows.length) {
    return empty ? <p style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{empty}</p> : null
  }
  const worst = Math.max(...rows.map((r) => Math.abs(r.pnl)), 1)

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
        color: 'var(--text-3)', marginBottom: 10,
      }}>{title}</div>

      {/* Its own scroll container: the page body must never scroll sideways. */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 460, borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: 'var(--text-3)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <Th align="left">Tag</Th><Th>Trades</Th><Th>Win %</Th><Th>PF</Th>
              <Th align="right">Avg</Th><Th align="right">Net</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <motion.tr key={r.slug}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                style={{ borderTop: '1px solid var(--stroke)' }}>
                <td style={{ padding: '9px 6px 9px 0' }}>
                  <Chip slug={r.slug} small />
                </td>
                <Td>{r.trades}</Td>
                <Td>{r.winRate.toFixed(0)}%</Td>
                <Td>{Number.isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : '∞'}</Td>
                <Td align="right"><Money value={r.avg} colored /></Td>
                <td style={{ padding: '9px 0', textAlign: 'right', minWidth: 130 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                    {/* A bar next to the number, because "−$1,240" and "−$180"
                        look the same in a column until they are drawn. */}
                    <div style={{ flex: '0 0 56px', height: 5, borderRadius: 20, background: 'var(--card-2)', overflow: 'hidden', display: 'flex', justifyContent: r.pnl >= 0 ? 'flex-start' : 'flex-end' }}>
                      <div style={{
                        width: `${(Math.abs(r.pnl) / worst) * 100}%`, height: '100%',
                        background: r.pnl >= 0 ? 'var(--mint)' : 'var(--red)',
                      }} />
                    </div>
                    <Money value={r.pnl} colored />
                  </div>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function Th({ children, align = 'center' }) {
  return <th style={{ padding: '0 6px 8px', textAlign: align, fontWeight: 600 }}>{children}</th>
}
function Td({ children, align = 'center' }) {
  return <td style={{ padding: '9px 6px', textAlign: align, color: 'var(--text-2)' }}>{children}</td>
}

/**
 * What the mistake tags have cost.
 *
 * Its own panel rather than a row in the table above, because it is the one
 * number on the page that should change what the trader does tomorrow.
 */
export function MistakeSummary({ trades }) {
  const m = useMemo(() => mistakeCost(trades), [trades])
  if (!m.trades) return null

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12,
    }}>
      <Cell label="Trades with a mistake" value={`${m.trades}`} sub={`${m.share.toFixed(0)}% of closed trades`} />
      <Cell label="Their net result" value={<Money value={m.pnl} colored />} />
      <Cell label="Lost on them" value={<Money value={-m.lostAmount} colored />} sub={`${m.losses} losing`} />
      <Cell label="Without them" value={<Money value={m.withoutThem} colored />}
        sub="not a promise — those trades might have been replaced by others" />
    </div>
  )
}

function Cell({ label, value, sub }) {
  return (
    <div style={{ padding: '12px 14px', borderRadius: 11, background: 'var(--card-2)' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 18, fontWeight: 700, marginTop: 5 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.45 }}>{sub}</div>}
    </div>
  )
}
