import { motion } from 'framer-motion'
import { useAuth } from '../lib/AuthContext'

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
        fontFamily: 'var(--display)', fontWeight: 800, color: '#04140d', fontSize: 20,
        boxShadow: '0 6px 20px -6px rgba(47,212,138,0.6)',
      }}>λ</div>
      <div style={{ lineHeight: 1.05, fontFamily: 'var(--display)', fontWeight: 800, fontSize: 15.5, letterSpacing: '0.02em' }}>
        <div>FOREX GREEK</div>
        <div className="grad-text">JOURNAL</div>
      </div>
    </div>
  )
}

export default function Shell({ active, onNav, onAdd, isDemo, children }) {
  return (
    <div className="app-shell" style={{ display: 'flex', minHeight: '100vh' }}>
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
          <UserCard />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="mobile-topbar">
        <Logo />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10.5, color: isDemo ? 'var(--amber)' : 'var(--mint)' }}>●</span>
          <UserAvatar />
        </div>
      </header>

      {/* Main */}
      <main style={{ flex: 1, minWidth: 0, padding: '24px 30px 60px' }} className="main">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav className="mobile-nav">
        {NAV.slice(0, 1).map((n) => <MobileTab key={n.key} n={n} active={active} onNav={onNav} />)}
        {NAV.slice(1, 2).map((n) => <MobileTab key={n.key} n={n} active={active} onNav={onNav} />)}
        <button className="mobile-add" onClick={onAdd} aria-label="Add trade">+</button>
        {NAV.slice(2).map((n) => <MobileTab key={n.key} n={n} active={active} onNav={onNav} />)}
      </nav>
    </div>
  )
}

function MobileTab({ n, active, onNav }) {
  const on = active === n.key
  return (
    <button onClick={() => onNav(n.key)}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        padding: '8px 0', fontSize: 10.5, fontWeight: 600,
        color: on ? 'var(--mint)' : 'var(--text-3)',
      }}>
      <span style={{ fontSize: 18 }}>{n.icon}</span>
      {n.label}
    </button>
  )
}

function UserAvatar() {
  const { user, signOut, requiresAuth } = useAuth()
  if (!requiresAuth || !user) return null
  const meta = user.user_metadata || {}
  const avatar = meta.avatar_url || meta.picture
  const name = meta.full_name || meta.name || user.email?.split('@')[0] || 'T'
  return (
    <button onClick={signOut} title="Sign out">
      {avatar ? (
        <img src={avatar} alt="" referrerPolicy="no-referrer"
          style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(140deg,#2fd48a,#128a56)', color: '#04140d', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{name[0]?.toUpperCase()}</div>
      )}
    </button>
  )
}

function UserCard() {
  const { user, signOut, requiresAuth } = useAuth()
  if (!requiresAuth || !user) return null

  const meta = user.user_metadata || {}
  const name = meta.full_name || meta.name || user.email?.split('@')[0] || 'Trader'
  const email = user.email || ''
  const avatar = meta.avatar_url || meta.picture

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
      border: '1px solid var(--stroke)', borderRadius: 12, background: 'var(--card)',
    }}>
      {avatar ? (
        <img src={avatar} alt="" referrerPolicy="no-referrer"
          style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }} />
      ) : (
        <div style={{
          width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(140deg,#2fd48a,#128a56)', color: '#04140d', fontWeight: 700, fontSize: 13,
        }}>{name[0]?.toUpperCase()}</div>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
        <div style={{ fontSize: 10.5, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{email}</div>
      </div>
      <button onClick={signOut} title="Sign out"
        style={{ color: 'var(--text-3)', fontSize: 16, padding: 4, flexShrink: 0 }}>⎋</button>
    </div>
  )
}
