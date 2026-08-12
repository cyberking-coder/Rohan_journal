import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import { usePrefs } from '../lib/theme'
import { formatMoney } from '../lib/format'

// The Dashboard's headline equity chart. The fill colour follows the direction
// of the period rather than being fixed, so a losing stretch reads as one at a
// glance.
export default function PerformanceChart({ data, positive, height = 280 }) {
  const { theme, currency, streamerMode } = usePrefs()
  const dark = theme === 'dark'
  const line = positive ? (dark ? '#2fd48a' : '#14a86a') : (dark ? '#ff6b6b' : '#d64545')
  const grid = dark ? '#161d1c' : '#e4ebe7'
  const axis = dark ? '#5c6a64' : '#7d8b84'

  if (!data.length) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13 }}>
        No closed trades in this period.
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="perfFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={line} stopOpacity={0.3} />
            <stop offset="100%" stopColor={line} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={{ fill: axis, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={36} />
        <YAxis
          tick={{ fill: axis, fontSize: 11 }} axisLine={false} tickLine={false} width={62}
          // Streamer Mode has to cover the axis too — the scale alone gives
          // away the account size even when the figures are blurred.
          tickFormatter={(v) => (streamerMode ? '•••' : formatMoney(v, { currency, digits: 0 }))}
        />
        <Tooltip
          content={({ active, payload, label }) => active && payload?.length ? (
            <div style={{
              background: 'var(--card)', border: '1px solid var(--stroke)', borderRadius: 10,
              padding: '8px 12px', fontSize: 12.5, boxShadow: 'var(--shadow)',
            }}>
              <div style={{ color: 'var(--text-3)', marginBottom: 3 }}>{label}</div>
              <div style={{ color: line, fontWeight: 600 }}>
                {streamerMode ? '•••••' : formatMoney(payload[0].value, { currency })}
              </div>
            </div>
          ) : null}
        />
        <Area type="monotone" dataKey="equity" stroke={line} strokeWidth={2.4}
          fill="url(#perfFill)" isAnimationActive animationDuration={900} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
