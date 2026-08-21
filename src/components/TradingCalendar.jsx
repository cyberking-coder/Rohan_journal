import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Money from './Money'
import { net } from '../lib/stats'
import { calendarMonth, calendarScale } from '../lib/analytics'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Month heatmap with the spec's eighth "Weekly" rollup column and a day detail
 * panel.
 *
 * The month is navigated independently of the page's period filter. Those two
 * genuinely mean different things — the filter says which trades count, the
 * arrows say which month you're looking at — and tying them together would
 * make "Last 7 days" render an almost entirely empty grid.
 */
export default function TradingCalendar({ trades }) {
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState(null)

  const { year, month } = useMemo(() => {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() + offset)
    return { year: d.getFullYear(), month: d.getMonth() }
  }, [offset])

  const weeks = useMemo(() => calendarMonth(trades, year, month), [trades, year, month])
  const scale = useMemo(() => calendarScale(weeks), [weeks])

  const monthTotal = weeks.reduce((s, w) => s + w.pnl, 0)
  const monthTrades = weeks.reduce((s, w) => s + w.count, 0)
  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const day = selected && weeks.flatMap((w) => w.days).find((d) => d.key === selected)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => { setOffset(offset - 1); setSelected(null) }} style={navBtn} aria-label="Previous month">‹</button>
          <span style={{ fontSize: 13.5, fontWeight: 600, minWidth: 130, textAlign: 'center' }}>{monthLabel}</span>
          <button onClick={() => { setOffset(offset + 1); setSelected(null) }} style={navBtn}
            disabled={offset >= 0} aria-label="Next month">›</button>
          {offset !== 0 && (
            <button onClick={() => { setOffset(0); setSelected(null) }}
              style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 2 }}>Today</button>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
          {monthTrades} trade{monthTrades === 1 ? '' : 's'} ·{' '}
          <span className="mono" style={{ fontWeight: 600 }}><Money value={monthTotal} digits={0} colored /></span>
        </div>
      </div>

      {/* Eight columns don't fit a phone. The card crops rather than pushing
          the page wide, which silently hides the Weekly rollup entirely — so
          the grid scrolls inside its own container instead, and the column
          stays reachable. */}
      <div style={{ overflowX: 'auto', margin: '0 -2px', padding: '0 2px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr) 1.15fr', gap: 4, minWidth: 430 }}>
          {DAY_LABELS.map((d) => (
            <div key={d} style={headCell}>{d}</div>
          ))}
          <div style={{ ...headCell, color: 'var(--text-2)' }}>Weekly</div>

          {weeks.map((week, wi) => (
            <Week key={wi} week={week} scale={scale} selected={selected} onSelect={setSelected} />
          ))}
        </div>
      </div>

      <AnimatePresence>
        {day && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22 }} style={{ overflow: 'hidden' }}>
            <DayDetail day={day} onClose={() => setSelected(null)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Week({ week, scale, selected, onSelect }) {
  return (
    <>
      {week.days.map((d) => (
        <DayCell key={d.key} day={d} scale={scale}
          selected={selected === d.key}
          onSelect={() => onSelect(selected === d.key ? null : d.key)} />
      ))}
      <div style={{
        borderRadius: 8, padding: '6px 8px', background: 'var(--card-2)',
        border: '1px solid var(--stroke)', display: 'flex', flexDirection: 'column', justifyContent: 'center',
      }}>
        <div style={{ fontSize: 9, color: 'var(--text-3)' }}>
          {week.tradingDays ? `${week.tradingDays}d · ${week.count}` : '—'}
        </div>
        <div className="mono" style={{ fontSize: 11.5, fontWeight: 600 }}>
          {week.count ? <Money value={week.pnl} digits={0} colored /> : ''}
        </div>
      </div>
    </>
  )
}

function DayCell({ day, scale, selected, onSelect }) {
  // Intensity is relative to the month's biggest day, so a quiet month still
  // shows contrast instead of rendering as one flat wash.
  const intensity = scale > 0 && day.count && !day.outside ? Math.min(1, Math.abs(day.pnl) / scale) : 0
  const up = day.pnl >= 0
  const base = up ? '47,212,138' : '255,107,107'

  // Padding days are grid alignment, nothing more. Showing their P&L makes a
  // boundary week visibly fail to add up — the rollup counts only this month's
  // days — so they carry the date and nothing else. They're a click away in
  // the neighbouring month.
  const active = day.count > 0 && !day.outside

  return (
    <button
      onClick={active ? onSelect : undefined}
      title={active ? `${day.count} trade${day.count === 1 ? '' : 's'}` : undefined}
      style={{
        // Fixed height rather than a square aspect ratio: eight columns across
        // a wide screen makes square cells ~130px tall, which pushes the rest
        // of the page off-screen for no gain in legibility.
        height: 62, borderRadius: 8, padding: '5px 6px',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        textAlign: 'left', cursor: day.count ? 'pointer' : 'default',
        opacity: day.outside ? 0.28 : 1,
        // 0.12 floor keeps a trading day visible even when its P&L is tiny
        // next to the month's biggest — otherwise it looks like no trades.
        background: day.count ? `rgba(${base}, ${0.12 + intensity * 0.55})` : 'var(--card-2)',
        border: `1px solid ${selected ? 'var(--text)' : 'var(--stroke)'}`,
        transition: 'border-color 0.15s',
      }}>
      <span style={{ fontSize: 10.5, color: active ? 'var(--text)' : 'var(--text-3)', fontWeight: active ? 600 : 400 }}>
        {day.day}
      </span>
      {active && (
        <span className="mono" style={{ fontSize: 9.5, fontWeight: 600 }}>
          <Money value={day.pnl} digits={0} />
        </span>
      )}
    </button>
  )
}

function DayDetail({ day, onClose }) {
  const label = day.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  const losses = day.count - day.wins

  return (
    <div style={{
      marginTop: 14, padding: 16, borderRadius: 12,
      background: 'var(--card-2)', border: '1px solid var(--stroke)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>
            {day.count} trade{day.count === 1 ? '' : 's'} · {day.wins}W / {losses}L
            {day.count > 0 && ` · ${((day.wins / day.count) * 100).toFixed(0)}% win`}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="mono" style={{ fontSize: 18, fontWeight: 700 }}>
            <Money value={day.pnl} digits={2} colored />
          </span>
          <button onClick={onClose} style={{ fontSize: 13, color: 'var(--text-3)' }} aria-label="Close">✕</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {day.trades.map((t) => (
          <div key={t.id ?? `${t.symbol}-${t.traded_at}`} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
            borderRadius: 8, background: 'var(--card)', fontSize: 12,
          }}>
            <span style={{ fontWeight: 600, minWidth: 78 }}>{(t.symbol || '—').toUpperCase()}</span>
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 4,
              color: (t.side || t.direction) ? 'var(--text-2)' : 'var(--text-3)',
              border: '1px solid var(--stroke)',
            }}>{t.side || t.direction || 'n/a'}</span>
            <span style={{ flex: 1, color: 'var(--text-3)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.strategy || t.setup || ''}
            </span>
            <span className="mono" style={{ fontWeight: 600 }}>
              {/* net(), not raw pnl — the day total above is net of fees and
                  swap, and two figures that disagree by a few dollars read as
                  a bug even when both are individually correct. */}
              <Money value={net(t)} digits={2} colored />
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const headCell = {
  fontSize: 9.5, letterSpacing: '0.05em', textTransform: 'uppercase',
  color: 'var(--text-3)', textAlign: 'center', paddingBottom: 2,
}

const navBtn = {
  width: 26, height: 26, borderRadius: 7, fontSize: 15,
  border: '1px solid var(--stroke)', color: 'var(--text-2)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
