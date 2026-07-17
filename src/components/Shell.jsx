import { motion } from 'framer-motion'

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: '◈' },
  { key: 'journal', label: 'Journal', icon: '▤' },
  { key: 'analysis', label: 'Analysis', icon: '◑' },
]

export function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: 'linear-gradient(140deg, #2fd48a, #128a56)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--display)', fontWeight: 800, color: '#04140d', fontSize: 18,
        boxShadow: '0 6px 20px -6px rgba(47,212,138,0.6)',
      }}>T</div>
      <div style={{ lineHeight: 1.05, fontFamily: 'var(--display)', fontWeight: 800, fontSize: 16, letterSpacing: '0.02em' }}>
        <div>TRADER</div>
        <div className="grad-text">BRAG</div>
      </div>
    </div>
  )
}

export default function Shell({ active, onNav, onAdd, isDemo, children }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <aside style={{
        width: 232, flexShrink: 0, borderRight: '1px solid var(--stroke)',
        padding: '26px 18px', display: 'flex', flexDirection: 'column', gap: 30,
        position: 'sticky', top: 0, height: '100vh',
        background: 'linear-gradient(180deg, rgba(15,20,19,0.6), transparent)',
      }} className="sidebar">
        <Logo />
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {NAV.map((n) => {
            const on = active === n.key
            return (
              <button key={n.key} onClick={() => onNav(n.key)}
                style={{
                  position: 'relative', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '11px 14px', borderRadius: 12, fontSize: 14.5, fontWeight: 500,
                  color: on ? 'var(--text)' : 'var(--text-2)',
                  background: on ? 'var(--card-2)' : 'transparent',
                  border: `1px solid ${on ? 'var(--stroke)' : 'transparent'}`,
                  transition: 'all 0.18s',
                }}>
                {on && (
                  <motion.span layoutId="navdot" style={{
                    position: 'absolute', left: 0, top: 12, bottom: 12, width: 3,
                    borderRadius: 3, background: 'var(--mint)',
                  }} />
                )}
                <span style={{ fontSize: 16, color: on ? 'var(--mint)' : 'var(--text-3)' }}>{n.icon}</span>
                {n.label}
              </button>
            )
          })}
        </nav>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <motion.button whileTap={{ scale: 0.96 }} onClick={onAdd}
            style={{
              padding: '12px', borderRadius: 12, fontWeight: 600, fontSize: 14,
              background: 'linear-gradient(120deg, #3ee39a, #23b978)', color: '#04140d',
              boxShadow: '0 10px 26px -10px rgba(47,212,138,0.7)',
            }}>+ Add Trade</motion.button>
          <div style={{
            fontSize: 11, color: 'var(--text-3)', padding: '10px 12px',
            border: '1px solid var(--stroke)', borderRadius: 10, lineHeight: 1.5,
          }}>
            <span style={{ color: isDemo ? 'var(--amber)' : 'var(--mint)' }}>●</span>{' '}
            {isDemo ? 'Demo data (local)' : 'Supabase connected'}
          </div>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, minWidth: 0, padding: '24px 30px 60px' }} className="main">
        {children}
      </main>

      <style>{`
        @media (max-width: 820px) {
          .sidebar { position: fixed; z-index: 40; transform: translateX(-100%); }
          .main { padding: 18px 16px 60px; }
        }
      `}</style>
    </div>
  )
}
