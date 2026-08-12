import { motion } from 'framer-motion'

// Shared chrome for every tool: a back link, the tool's identity, and an
// optional control slot on the right. Future tools drop straight into this.
export default function ToolPageShell({ icon, title, subtitle, onBack, headerActions, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <button onClick={onBack}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 18,
          fontSize: 12.5, color: 'var(--text-3)', padding: '6px 10px 6px 6px', borderRadius: 8,
        }}>
        <span style={{ fontSize: 14 }}>←</span> Back to Tools
      </button>

      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 16, flexWrap: 'wrap', marginBottom: 22,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 13, flexShrink: 0, fontSize: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--card-2)', border: '1px solid var(--stroke)', color: 'var(--mint)',
          }}>{icon}</div>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontFamily: 'var(--display)', fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>{title}</h1>
            {subtitle && <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 3 }}>{subtitle}</p>}
          </div>
        </div>
        {headerActions}
      </div>

      {children}
    </motion.div>
  )
}
