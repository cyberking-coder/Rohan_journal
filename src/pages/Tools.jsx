import { motion } from 'framer-motion'
import { PageHeader } from '../components/common'
import { useQueryParam } from '../lib/router'
import { AVAILABLE_COUNT, COMING_SOON_COUNT, TOOLS, getTool } from '../lib/tools'
import PositionSizeCalculator from './tools/PositionSizeCalculator'
import MarketHours from './tools/MarketHours'

// Tools that are actually implemented. A tool listed in the registry but
// missing here falls back to the grid rather than rendering a blank page.
const TOOL_PAGES = {
  'position-size': PositionSizeCalculator,
  'market-hours': MarketHours,
}

export default function Tools() {
  const [toolId, setToolId] = useQueryParam('tool')

  const ToolPage = toolId ? TOOL_PAGES[toolId] : null
  if (ToolPage) return <ToolPage onBack={() => setToolId(null)} />

  return <ToolGrid onOpen={setToolId} />
}

function ToolGrid({ onOpen }) {
  return (
    <>
      <PageHeader eyebrow="Trading Tools" title="Tools">
        <div style={{ display: 'flex', gap: 8 }}>
          <Counter value={AVAILABLE_COUNT} label="Available" tone="var(--mint)" />
          <Counter value={COMING_SOON_COUNT} label="Coming Soon" tone="var(--text-3)" />
        </div>
      </PageHeader>

      <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginTop: -12, marginBottom: 22, maxWidth: 560, lineHeight: 1.6 }}>
        Calculators and utilities that support the way you actually trade.
      </p>

      <div className="tools-grid">
        {TOOLS.map((t, i) => <ToolCard key={t.id} tool={t} index={i} onOpen={onOpen} />)}
      </div>

      <div style={{
        marginTop: 20, padding: '16px 18px', borderRadius: 14, fontSize: 12.5,
        color: 'var(--text-3)', lineHeight: 1.65,
        border: '1px dashed var(--stroke)', background: 'var(--card)',
      }}>
        <strong style={{ color: 'var(--text-2)', fontWeight: 600 }}>More tools coming.</strong>{' '}
        Each one arrives with the phase noted on its card — see{' '}
        <span className="mono" style={{ color: 'var(--text-2)' }}>docs/README.md</span> for the plan.
      </div>
    </>
  )
}

function Counter({ value, label, tone }) {
  return (
    <div style={{
      padding: '7px 13px', borderRadius: 10, display: 'flex', alignItems: 'baseline', gap: 6,
      background: 'var(--card)', border: '1px solid var(--stroke)',
    }}>
      <span className="mono" style={{ fontSize: 15, fontWeight: 700, color: tone }}>{value}</span>
      <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{label}</span>
    </div>
  )
}

const BADGE_TONES = {
  Popular: { color: 'var(--amber)', border: 'rgba(255,207,107,0.35)' },
  Live: { color: 'var(--mint)', border: 'rgba(47,212,138,0.35)' },
  New: { color: 'var(--info)', border: 'currentColor' },
}

function ToolCard({ tool, index, onOpen }) {
  const badge = tool.ready ? tool.badge : 'Coming Soon'
  const tone = BADGE_TONES[badge] || { color: 'var(--text-3)', border: 'var(--stroke)' }

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
      whileHover={tool.ready ? { y: -3 } : undefined}
      style={{
        padding: 20, display: 'flex', flexDirection: 'column', gap: 11,
        opacity: tool.ready ? 1 : 0.62,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12, fontSize: 19, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--card-2)', border: '1px solid var(--stroke)',
          color: tool.ready ? 'var(--mint)' : 'var(--text-3)',
        }}>{tool.icon}</div>
        {badge && (
          <span style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            padding: '4px 7px', borderRadius: 6,
            color: tone.color, border: `1px solid ${tone.border}`,
          }}>{badge}</span>
        )}
      </div>

      <h3 style={{ fontFamily: 'var(--display)', fontSize: 15, fontWeight: 600 }}>{tool.name}</h3>
      <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6, flex: 1 }}>{tool.description}</p>

      {tool.ready ? (
        <button onClick={() => onOpen(tool.id)}
          style={{
            alignSelf: 'flex-start', marginTop: 2, fontSize: 12.5, fontWeight: 600,
            color: 'var(--mint)', display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>Open tool <span style={{ fontSize: 13 }}>→</span></button>
      ) : (
        <span style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>
          In development · phase {tool.phase}
        </span>
      )}
    </motion.div>
  )
}
