import { motion } from 'framer-motion'
import { fmtMoney } from '../lib/stats'

export function StatCard({ label, value, sub, accent, delay = 0, children }) {
  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3 }}
      style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <span className="eyebrow">{label}</span>
      <span
        className="mono"
        style={{ fontSize: 26, fontWeight: 600, color: accent || 'var(--text)', letterSpacing: '-0.02em' }}
      >
        {value}
      </span>
      {sub && <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{sub}</span>}
      {children}
    </motion.div>
  )
}

// Circular win-rate gauge
export function DonutGauge({ value = 0, label = 'Win rate', size = 132 }) {
  const stroke = 12
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  const offset = c - (pct / 100) * c
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--track)" strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r}
          stroke="url(#gaugeGrad)" strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
        <defs>
          <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3ee39a" />
            <stop offset="100%" stopColor="#1c9d68" />
          </linearGradient>
        </defs>
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <span className="mono" style={{ fontSize: 26, fontWeight: 700 }}>{pct.toFixed(0)}%</span>
        <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
      </div>
    </div>
  )
}

// Hexagon stat used for Risk / Reward and Profit Factor
export function HexStat({ value, label, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
    >
      <div style={{
        width: 84, height: 96,
        clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
        background: 'var(--hex-bg)',
        border: '1px solid var(--stroke)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: 'inset 0 0 24px rgba(47,212,138,0.08)',
      }}>
        <span className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{value}</span>
      </div>
      <span className="eyebrow">{label}</span>
    </motion.div>
  )
}

export function MiniStat({ icon, label, value, accent }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 38, height: 38, borderRadius: 10, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--card-2)', border: '1px solid var(--stroke)', fontSize: 16,
      }}>{icon}</div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 11.5, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
        <span className="mono" style={{ fontSize: 16, fontWeight: 600, color: accent || 'var(--text)' }}>{value}</span>
      </div>
    </div>
  )
}

export function PnlPill({ value }) {
  const positive = value >= 0
  return (
    <span style={{
      fontFamily: 'var(--mono)', fontSize: 12.5, fontWeight: 600,
      color: positive ? 'var(--mint)' : 'var(--red)',
      background: positive ? 'rgba(47,212,138,0.1)' : 'rgba(255,107,107,0.1)',
      padding: '3px 9px', borderRadius: 8,
    }}>{fmtMoney(value)}</span>
  )
}
