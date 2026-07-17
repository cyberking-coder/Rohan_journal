import { motion } from 'framer-motion'
import { RANGES } from '../lib/stats'

export function PageHeader({ eyebrow, title, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}
    >
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 6 }}>{title}</h1>
      </div>
      {children}
    </motion.div>
  )
}

export function RangeTabs({ value, onChange, keys = ['week', 'month', 'quarter', 'all'] }) {
  return (
    <div style={{ display: 'flex', gap: 4, background: 'var(--card)', border: '1px solid var(--stroke)', borderRadius: 12, padding: 4 }}>
      {keys.map((k) => {
        const on = value === k
        return (
          <button key={k} onClick={() => onChange(k)}
            style={{ position: 'relative', padding: '8px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, color: on ? '#04140d' : 'var(--text-2)' }}>
            {on && <motion.span layoutId="rangepill" style={{ position: 'absolute', inset: 0, borderRadius: 9, background: 'linear-gradient(120deg, #3ee39a, #23b978)' }} />}
            <span style={{ position: 'relative' }}>{RANGES[k].label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function Panel({ title, right, children, delay = 0, style }) {
  return (
    <motion.section
      className="card"
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      style={{ padding: 22, ...style }}
    >
      {(title || right) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h3 style={{ fontFamily: 'var(--display)', fontSize: 15.5, fontWeight: 600 }}>{title}</h3>
          {right}
        </div>
      )}
      {children}
    </motion.section>
  )
}
