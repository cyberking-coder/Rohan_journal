import {
  Area, AreaChart, Bar, BarChart, Cell, ResponsiveContainer,
  Tooltip, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import { fmtMoney } from '../lib/stats'
import { useTheme } from '../lib/theme'

// Recharts writes most of these straight onto SVG presentation attributes,
// where `var(--token)` isn't a legal value — so the chart palette is resolved
// in JS from the active theme rather than read from CSS.
const CHART_COLORS = {
  dark: {
    grid: '#161d1c',
    axis: '#5c6a64',
    axisStrong: '#9aa8a3',
    mint: '#2fd48a',
    red: '#ff6b6b',
    neutral: '#c9d3ce',
    neutralFill: '#e9efec',
    cursor: 'rgba(255,255,255,0.03)',
  },
  light: {
    grid: '#e4ebe7',
    axis: '#7d8b84',
    axisStrong: '#4d5c56',
    mint: '#14a86a',
    red: '#d64545',
    neutral: '#8a9a93',
    neutralFill: '#6f7f78',
    cursor: 'rgba(0,0,0,0.04)',
  },
}

function useChartColors() {
  const { theme } = useTheme()
  return CHART_COLORS[theme] || CHART_COLORS.dark
}

// Chart axes and tooltips carry money too, so Streamer Mode has to reach them.
// Blurring the whole chart would hide the shape, which is the part worth
// seeing — so only the figures are masked.
function useMoneyMask() {
  const { streamerMode } = useTheme()
  return {
    axis: (fn) => (v) => (streamerMode ? '•••' : fn(v)),
    tip: (text) => (streamerMode ? '•••••' : text),
  }
}

function TipBox({ children }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--stroke)', borderRadius: 10,
      padding: '8px 12px', fontSize: 12.5, boxShadow: 'var(--shadow)',
    }}>{children}</div>
  )
}

export function EquityCurve({ data }) {
  const c = useChartColors()
  const mask = useMoneyMask()
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="netFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.mint} stopOpacity={0.28} />
            <stop offset="100%" stopColor={c.mint} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="grossFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.neutralFill} stopOpacity={0.12} />
            <stop offset="100%" stopColor={c.neutralFill} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="date" tick={{ fill: c.axis, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={40} />
        <YAxis tick={{ fill: c.axis, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={mask.axis((v) => `$${(v / 1000).toFixed(0)}k`)} />
        <Tooltip
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TipBox>
                <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>{label}</div>
                <div style={{ color: 'var(--mint)' }}>Net&nbsp;&nbsp;{mask.tip(fmtMoney(payload.find((p) => p.dataKey === 'net')?.value))}</div>
                <div style={{ color: 'var(--text-2)' }}>Gross&nbsp;{mask.tip(fmtMoney(payload.find((p) => p.dataKey === 'gross')?.value))}</div>
              </TipBox>
            ) : null
          }
        />
        <Area type="monotone" dataKey="gross" stroke={c.neutral} strokeWidth={1.6} fill="url(#grossFill)" isAnimationActive animationDuration={1100} />
        <Area type="monotone" dataKey="net" stroke={c.mint} strokeWidth={2.4} fill="url(#netFill)" isAnimationActive animationDuration={1300} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function PnlBars({ data, height = 190 }) {
  const c = useChartColors()
  const mask = useMoneyMask()
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="date" tick={{ fill: c.axis, fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={26} />
        <YAxis tick={{ fill: c.axis, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={mask.axis((v) => `$${v}`)} />
        <Tooltip
          cursor={{ fill: c.cursor }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TipBox>
                <div style={{ color: 'var(--text-3)', marginBottom: 2 }}>{label}</div>
                <div style={{ color: payload[0].value >= 0 ? 'var(--mint)' : 'var(--red)' }}>{mask.tip(fmtMoney(payload[0].value))}</div>
              </TipBox>
            ) : null
          }
        />
        <Bar dataKey="pnl" radius={[3, 3, 0, 0]} isAnimationActive animationDuration={900}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.pnl >= 0 ? c.mint : c.neutralFill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function SessionBars({ data }) {
  const c = useChartColors()
  const mask = useMoneyMask()
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 46)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid stroke={c.grid} horizontal={false} />
        <XAxis type="number" tick={{ fill: c.axis, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={mask.axis((v) => `$${v}`)} />
        <YAxis type="category" dataKey="session" width={70} tick={{ fill: c.axisStrong, fontSize: 12 }} axisLine={false} tickLine={false} />
        <Tooltip
          cursor={{ fill: c.cursor }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TipBox>
                <div style={{ marginBottom: 2 }}>{payload[0].payload.session}</div>
                <div style={{ color: payload[0].value >= 0 ? 'var(--mint)' : 'var(--red)' }}>{mask.tip(fmtMoney(payload[0].value))}</div>
                <div style={{ color: 'var(--text-3)' }}>{payload[0].payload.count} trades · {payload[0].payload.winRate.toFixed(0)}% win</div>
              </TipBox>
            ) : null
          }
        />
        <Bar dataKey="pnl" radius={[0, 6, 6, 0]} isAnimationActive animationDuration={900}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.pnl >= 0 ? c.mint : c.red} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
