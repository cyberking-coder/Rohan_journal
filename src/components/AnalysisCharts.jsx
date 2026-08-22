import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Area, AreaChart, Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import { useTheme } from '../lib/theme'
import Money, { Amount } from './Money'
import { cumulativeEquity, drawdownSeries } from '../lib/analytics'
import { fmtMinute, segments } from '../lib/sessionConfig'

// Same reasoning as charts.jsx: Recharts writes these onto SVG presentation
// attributes, where `var(--token)` isn't legal, so the palette is resolved in
// JS from the active theme.
const PALETTE = {
  dark: { grid: '#161d1c', axis: '#5c6a64', mint: '#2fd48a', red: '#ff6b6b', amber: '#f0b24a', info: '#5aa9e6', muted: '#3a4441' },
  light: { grid: '#e4ebe7', axis: '#7d8b84', mint: '#14a86a', red: '#d64545', amber: '#c88a1e', info: '#2f7fb8', muted: '#c7d2cc' },
}

export function usePalette() {
  const { theme } = useTheme()
  return PALETTE[theme] || PALETTE.dark
}

// Streamer Mode has to reach chart axes and tooltips too — they carry money
// like any other figure. The shape of the curve stays visible; only the
// numbers are masked.
function useMask() {
  const { streamerMode } = useTheme()
  return {
    on: streamerMode,
    axis: (fn) => (v) => (streamerMode ? '•••' : fn(v)),
    text: (t) => (streamerMode ? '•••••' : t),
  }
}

function Tip({ children }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--stroke)', borderRadius: 10,
      padding: '8px 12px', fontSize: 12.5, boxShadow: 'var(--shadow)',
    }}>{children}</div>
  )
}

const money = (v) => `${v < 0 ? '-' : ''}$${Math.abs(Math.round(v)).toLocaleString()}`
// A shared view can express results as risk multiples instead of currency.
// The axis and tooltip have to follow, or the chart quietly re-prints the
// account size the owner asked to hide.
const rMultiple = (v) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}R`
const amountFmt = (unit) => (unit === 'R' ? rMultiple : money)

// ---------------------------------------------------------------------------
// Equity curve, with the Drawdown view behind a toggle
// ---------------------------------------------------------------------------

export function EquityDrawdown({ trades, unit = 'money' }) {
  const [mode, setMode] = useState('equity')
  const c = usePalette()
  const mask = useMask()

  const data = useMemo(() => {
    const series = mode === 'equity' ? cumulativeEquity(trades) : drawdownSeries(trades)
    return series.map((p, i) => ({
      i: i + 1,
      label: p.at ? new Date(p.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '',
      value: mode === 'equity' ? p.equity : p.drawdown,
    }))
  }, [trades, mode])

  const isDrawdown = mode === 'drawdown'
  const stroke = isDrawdown ? c.red : c.mint
  const fmt = amountFmt(unit)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 3, background: 'var(--card-2)', borderRadius: 9, padding: 3 }}>
          {[['equity', 'Equity'], ['drawdown', 'Drawdown']].map(([key, label]) => (
            <button key={key} onClick={() => setMode(key)}
              style={{
                padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                background: mode === key ? 'var(--card-hover)' : 'transparent',
                color: mode === key ? 'var(--text)' : 'var(--text-3)',
              }}>{label}</button>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <EmptyChart height={260} message="No closed trades in this period." />
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
            <defs>
              <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.26} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: c.axis, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={44} />
            <YAxis tick={{ fill: c.axis, fontSize: 11 }} axisLine={false} tickLine={false}
              tickFormatter={mask.axis(fmt)} width={64} />
            <ReferenceLine y={0} stroke={c.axis} strokeDasharray="3 3" />
            <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
              <Tip>
                <div style={{ color: 'var(--text-3)', marginBottom: 3 }}>{label}</div>
                <div style={{ color: stroke }}>
                  {isDrawdown ? 'Drawdown' : 'Equity'}&nbsp;&nbsp;{mask.text(fmt(payload[0].value))}
                </div>
              </Tip>
            ) : null} />
            <Area type="monotone" dataKey="value" stroke={stroke} strokeWidth={2.2}
              fill="url(#eqFill)" isAnimationActive animationDuration={900} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

/** The eight-figure strip beneath the equity curve. */
export function MetricStrip({ items, unit = 'money' }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(108px, 1fr))',
      gap: 1, background: 'var(--stroke)', border: '1px solid var(--stroke)',
      borderRadius: 12, overflow: 'hidden', marginTop: 14,
    }}>
      {items.map((m) => (
        <div key={m.label} style={{ background: 'var(--card)', padding: '11px 13px' }}>
          <div style={{ fontSize: 9.5, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
            {m.label}
          </div>
          <div className="mono" style={{ fontSize: 14.5, fontWeight: 600, marginTop: 4, color: m.color || 'var(--text)' }}>
            {/* Money masks itself; counts and percentages stay readable. */}
            {m.money !== undefined ? <Amount value={m.money} unit={unit} digits={0} colored={m.colored} /> : m.value}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Win / loss distribution
// ---------------------------------------------------------------------------

export function DistributionChart({ buckets }) {
  const c = usePalette()
  const mask = useMask()
  if (!buckets.length) return <EmptyChart height={200} message="No trades to distribute." />

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={buckets} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="label" tick={{ fill: c.axis, fontSize: 9.5 }} axisLine={false} tickLine={false}
          interval={0} tickFormatter={mask.axis((v) => v)} />
        <YAxis tick={{ fill: c.axis, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip cursor={{ fill: 'transparent' }} content={({ active, payload }) => active && payload?.length ? (
          <Tip>
            <div style={{ color: 'var(--text-3)' }}>{mask.text(payload[0].payload.range)}</div>
            <div>{payload[0].value} trade{payload[0].value === 1 ? '' : 's'}</div>
          </Tip>
        ) : null} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={800}>
          {buckets.map((b, i) => <Cell key={i} fill={b.positive ? c.mint : c.red} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ---------------------------------------------------------------------------
// Long vs short, day of week, top symbols — all comparative bars
// ---------------------------------------------------------------------------

/**
 * A row of labelled bars scaled against the largest absolute value.
 *
 * Used for three different breakdowns rather than writing three near-identical
 * components. Bars are drawn from a shared centre so losses read as losses
 * rather than as short wins.
 */
export function ComparisonBars({ rows, labelKey = 'label', unit = 'money', emptyMessage = 'Nothing to show yet.' }) {
  const active = rows.filter((r) => r.count > 0)
  if (!active.length) return <EmptyChart height={140} message={emptyMessage} />

  const max = Math.max(...active.map((r) => Math.abs(r.pnl)), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {rows.map((r) => {
        const pct = (Math.abs(r.pnl) / max) * 100
        const up = r.pnl >= 0
        return (
          // Every piece gets its own column. Laying the figures *over* the bar
          // reads fine until a bar grows long enough to sit under them, and
          // then the P&L is unreadable exactly on the rows that matter most.
          <div key={r[labelKey]} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{
              width: 58, fontSize: 12, color: 'var(--text-2)', flexShrink: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }} title={r[labelKey]}>{r[labelKey]}</div>

            <div style={{ width: 54, flexShrink: 0, fontSize: 10, color: 'var(--text-3)', textAlign: 'right' }}>
              {r.count ? `${r.count} · ${r.winRate.toFixed(0)}%` : '—'}
            </div>

            <div style={{ flex: 1, minWidth: 30, height: 16, background: 'var(--card-2)', borderRadius: 5, overflow: 'hidden' }}>
              {r.count > 0 && (
                <motion.div
                  initial={{ width: 0 }} animate={{ width: `${Math.max(pct, 2)}%` }}
                  transition={{ duration: 0.55, ease: 'easeOut' }}
                  style={{ height: '100%', borderRadius: 5, background: up ? 'var(--mint)' : 'var(--red)', opacity: 0.85 }} />
              )}
            </div>

            <div className="mono" style={{ width: 74, flexShrink: 0, fontSize: 11.5, fontWeight: 600, textAlign: 'right' }}>
              {r.count ? <Amount value={r.pnl} unit={unit} digits={unit === 'R' ? 1 : 0} colored /> : ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Session performance
// ---------------------------------------------------------------------------

/**
 * A 24-hour UTC timeline with the three analysis sessions laid over it and a
 * marker at the current hour.
 *
 * The marker is the point: it turns an abstract "London 08–13" into "you are
 * here", which is what makes the session breakdown actionable rather than
 * historical trivia.
 */
export function SessionTimeline({ sessions, now = new Date() }) {
  // The bar draws the same session list the cards below it summarise, rather
  // than a module-level constant. They used to be able to disagree — the bar
  // said "London 08–13" while the cards counted whatever the user had
  // configured, and nothing in the UI admitted it.
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes()
  const left = (minute / 1440) * 100

  return (
    <div>
      <div style={{ position: 'relative', height: 44, borderRadius: 10, overflow: 'hidden', background: 'var(--card-2)' }}>
        {sessions.map((s) => (
          // A window that wraps midnight draws as two segments — one at each
          // end of the axis — rather than a single block running backwards off
          // the edge.
          segments(s).map(({ start, end }, i) => (
            <div key={`${s.id}-${i}`}
              title={`${s.label} ${fmtMinute(s.start)}–${fmtMinute(s.end)} UTC`}
              style={{
                position: 'absolute', top: 0, bottom: 0,
                left: `${(start / 1440) * 100}%`, width: `${((end - start) / 1440) * 100}%`,
                background: s.tint, opacity: 0.16,
                borderRight: '1px solid var(--stroke)',
              }} />
          ))
        ))}

        {sessions.map((s) => {
          const width = s.start < s.end ? s.end - s.start : 1440 - s.start + s.end
          const mid = ((s.start + width / 2) % 1440)
          // A narrow window can't hold its own name, and overlapping labels are
          // worse than none — kill zones are often under two hours wide.
          if (width < 100) return null
          return (
            <div key={`${s.id}-label`} style={{
              position: 'absolute', top: 6, left: `${(mid / 1440) * 100}%`, transform: 'translateX(-50%)',
              fontSize: 10, fontWeight: 600, color: 'var(--text-2)', whiteSpace: 'nowrap', pointerEvents: 'none',
            }}>{s.label}</div>
          )
        })}

        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{
            position: 'absolute', top: 0, bottom: 0, left: `${left}%`, width: 2,
            background: 'var(--text)', boxShadow: '0 0 8px var(--text)',
          }} />
        <div style={{
          position: 'absolute', bottom: 3, left: `${left}%`, transform: 'translateX(-50%)',
          fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)',
          background: 'var(--card)', padding: '1px 4px', borderRadius: 3, whiteSpace: 'nowrap',
        }}>NOW</div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 9.5, color: 'var(--text-3)' }}>
        {[0, 6, 12, 18, 24].map((h) => <span key={h}>{String(h % 24).padStart(2, '0')}:00</span>)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 14 }}>
        {sessions.map((s) => (
          <div key={s.id} style={{
            padding: '12px 14px', borderRadius: 11, background: 'var(--card-2)',
            border: '1px solid var(--stroke)', borderLeft: `2px solid ${s.tint}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{s.label}</span>
              <span style={{ fontSize: 9.5, color: 'var(--text-3)' }} className="mono">
                {fmtMinute(s.start)}–{fmtMinute(s.end)} UTC
              </span>
            </div>
            <div className="mono" style={{ fontSize: 17, fontWeight: 600, marginTop: 6 }}>
              <Money value={s.pnl} digits={0} colored />
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 3 }}>
              {s.count} trade{s.count === 1 ? '' : 's'}
              {s.count > 0 && ` · ${s.winRate.toFixed(0)}% win`}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function EmptyChart({ height = 200, message }) {
  return (
    <div style={{
      height, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12.5, color: 'var(--text-3)', textAlign: 'center', padding: 16,
    }}>{message}</div>
  )
}
