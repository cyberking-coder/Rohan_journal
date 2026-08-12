import { motion } from 'framer-motion'
import { PageHeader } from '../components/common'

// Placeholder for sections that exist in the nav but whose phase hasn't been
// built yet. Being explicit about which phase owns the work beats a dead link.
export default function ComingSoon({ view }) {
  if (!view) return null

  return (
    <>
      <PageHeader eyebrow={`Phase ${view.phase}`} title={view.label} />
      <motion.div
        className="card"
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        style={{
          padding: '56px 28px', textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
        }}
      >
        <div style={{
          width: 58, height: 58, borderRadius: 18, fontSize: 26,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--card-2)', border: '1px solid var(--stroke)', color: 'var(--mint)',
        }}>{view.icon}</div>

        <h2 style={{ fontFamily: 'var(--display)', fontSize: 20, fontWeight: 600 }}>
          {view.label} is on the way
        </h2>

        <p style={{ fontSize: 13.5, color: 'var(--text-2)', maxWidth: 400, lineHeight: 1.65 }}>
          {view.description}
        </p>

        <p style={{ fontSize: 12, color: 'var(--text-3)', maxWidth: 400, lineHeight: 1.6 }}>
          Scheduled for phase {view.phase} of the build plan — see{' '}
          <span className="mono" style={{ color: 'var(--text-2)' }}>docs/README.md</span>.
        </p>
      </motion.div>
    </>
  )
}
