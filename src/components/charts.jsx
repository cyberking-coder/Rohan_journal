import {
  Area, AreaChart, Bar, BarChart, Cell, ResponsiveContainer,
  Tooltip, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import { fmtMoney } from '../lib/stats'

function TipBox({ children }) {
  return (
    <div style={{
      background: '#0c1211', border: '1px solid var(--stroke)', borderRadius: 10,
      padding: '8px 12px', fontSize: 12.5, boxShadow: 'var(--shadow)',
    }}>{children}</div>
  )
}

export function EquityCurve({ data }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="netFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2fd48a" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#2fd48a" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="grossFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e9efec" stopOpacity={0.12} />
            <stop offset="100%" stopColor="#e9efec" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#161d1c" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: '#5c6a64', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={40} />
        <YAxis tick={{ fill: '#5c6a64', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
        <Tooltip
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TipBox>
                <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>{label}</div>
                <div style={{ color: 'var(--mint)' }}>Net&nbsp;&nbsp;{fmtMoney(payload.find((p) => p.dataKey === 'net')?.value)}</div>
                <div style={{ color: 'var(--text-2)' }}>Gross&nbsp;{fmtMoney(payload.find((p) => p.dataKey === 'gross')?.value)}</div>
              </TipBox>
            ) : null
          }
        />
        <Area type="monotone" dataKey="gross" stroke="#c9d3ce" strokeWidth={1.6} fill="url(#grossFill)" isAnimationActive animationDuration={1100} />
        <Area type="monotone" dataKey="net" stroke="#2fd48a" strokeWidth={2.4} fill="url(#netFill)" isAnimationActive animationDuration={1300} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function PnlBars({ data, height = 190 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid stroke="#161d1c" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: '#5c6a64', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={26} />
        <YAxis tick={{ fill: '#5c6a64', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.03)' }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TipBox>
                <div style={{ color: 'var(--text-3)', marginBottom: 2 }}>{label}</div>
                <div style={{ color: payload[0].value >= 0 ? 'var(--mint)' : 'var(--red)' }}>{fmtMoney(payload[0].value)}</div>
              </TipBox>
            ) : null
          }
        />
        <Bar dataKey="pnl" radius={[3, 3, 0, 0]} isAnimationActive animationDuration={900}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.pnl >= 0 ? '#2fd48a' : '#e9efec'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function SessionBars({ data }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 46)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid stroke="#161d1c" horizontal={false} />
        <XAxis type="number" tick={{ fill: '#5c6a64', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
        <YAxis type="category" dataKey="session" width={70} tick={{ fill: '#9aa8a3', fontSize: 12 }} axisLine={false} tickLine={false} />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.03)' }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TipBox>
                <div style={{ marginBottom: 2 }}>{payload[0].payload.session}</div>
                <div style={{ color: payload[0].value >= 0 ? 'var(--mint)' : 'var(--red)' }}>{fmtMoney(payload[0].value)}</div>
                <div style={{ color: 'var(--text-3)' }}>{payload[0].payload.count} trades · {payload[0].payload.winRate.toFixed(0)}% win</div>
              </TipBox>
            ) : null
          }
        />
        <Bar dataKey="pnl" radius={[0, 6, 6, 0]} isAnimationActive animationDuration={900}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.pnl >= 0 ? '#2fd48a' : '#ff6b6b'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
