import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../lib/AuthContext'
import { useTheme } from '../lib/theme'
import { VIEWS } from '../lib/views'
import TopBar from './TopBar'

// The bottom tab bar can't hold ten sections, so it carries the three built
// pages plus quick-add, and everything else is one tap away in the palette.
const MOBILE_KEYS = ['dashboard', 'journal', 'analysis']

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

export default function Shell({ active, onNav, onAdd, onSearch, isDemo, children }) {
  return (
    <div className="app-shell" style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <aside style={{
        width: 232, flexShrink: 0, borderRight: '1px solid var(--stroke)',
        padding: '26px 18px', display: 'flex', flexDirection: 'column', gap: 22,
        position: 'sticky', top: 0, height: '100vh',
        background: 'var(--sidebar-bg)',
      }} className="sidebar">
        <Logo />

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'auto', margin: '0 -4px', padding: '0 4px' }}>
          {VIEWS.map((n) => {
            const on = active === n.key
            return (
              <button key={n.key} onClick={() => onNav(n.key)}
                title={n.ready ? n.description : `${n.description} — arrives in phase ${n.phase}`}
                style={{
                  position: 'relative', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '9px 14px', borderRadius: 12, fontSize: 14, fontWeight: 500,
                  color: on ? 'var(--text)' : n.ready ? 'var(--text-2)' : 'var(--text-3)',
                  background: on ? 'var(--card-2)' : 'transparent',
                  border: `1px solid ${on ? 'var(--stroke)' : 'transparent'}`,
                  transition: 'all 0.18s',
                }}>
                {on && (
                  <motion.span layoutId="navdot" style={{
                    position: 'absolute', left: 0, top: 10, bottom: 10, width: 3,
                    borderRadius: 3, background: 'var(--mint)',
                  }} />
                )}
                <span style={{ fontSize: 15, color: on ? 'var(--mint)' : 'var(--text-3)' }}>{n.icon}</span>
                <span style={{ flex: 1, textAlign: 'left' }}>{n.label}</span>
                {!n.ready && (
                  <span style={{
                    fontSize: 8.5, letterSpacing: '0.06em', textTransform: 'uppercase',
                    padding: '2px 5px', borderRadius: 4, color: 'var(--text-3)',
                    border: '1px solid var(--stroke)',
                  }}>soon</span>
                )}
              </button>
            )
          })}
        </nav>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <motion.button whileTap={{ scale: 0.96 }} onClick={onAdd}
            style={{
              padding: '11px', borderRadius: 12, fontWeight: 600, fontSize: 13.5,
              background: 'linear-gradient(120deg, #3ee39a, #23b978)', color: '#04140d',
              boxShadow: '0 10px 26px -10px rgba(47,212,138,0.7)',
            }}>+ Add Trade</motion.button>
          <div style={{
            fontSize: 11, color: 'var(--text-3)', padding: '9px 12px',
            border: '1px solid var(--stroke)', borderRadius: 10, lineHeight: 1.5,
          }}>
            <span style={{ color: isDemo ? 'var(--amber)' : 'var(--mint)' }}>●</span>{' '}
            {isDemo ? 'Demo data (local)' : 'Supabase connected'}
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="mobile-topbar">
        <Logo />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onSearch} aria-label="Search" style={{ fontSize: 17, color: 'var(--text-2)' }}>⌕</button>
          <MobileThemeToggle />
          <span style={{ fontSize: 10.5, color: isDemo ? 'var(--amber)' : 'var(--mint)' }}>●</span>
          <UserAvatar />
        </div>
      </header>

      {/* Main */}
      <main style={{ flex: 1, minWidth: 0, padding: '24px 30px 60px' }} className="main">
        <TopBar view={active} onSearch={onSearch} onAdd={onAdd} isDemo={isDemo} />
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav className="mobile-nav">
        <MobileTab k="dashboard" active={active} onNav={onNav} />
        <MobileTab k="journal" active={active} onNav={onNav} />
        <button className="mobile-add" onClick={onAdd} aria-label="Add trade">+</button>
        <MobileTab k="analysis" active={active} onNav={onNav} />
        <button onClick={onSearch} aria-label="All sections"
          style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            padding: '8px 0', fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)',
          }}>
          <span style={{ fontSize: 18 }}>⋯</span>
          More
        </button>
      </nav>
    </div>
  )
}

function MobileTab({ k, active, onNav }) {
  const n = VIEWS.find((v) => v.key === k)
  if (!n) return null
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

function MobileThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  return (
    <button onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{ fontSize: 15, color: 'var(--text-2)' }}>
      {theme === 'dark' ? '☾' : '☀'}
    </button>
  )
}

// Mobile-only avatar; the desktop profile menu lives in the top bar.
function UserAvatar() {
  const { user, signOut, requiresAuth } = useAuth()
  const [confirming, setConfirming] = useState(false)
  if (!requiresAuth || !user) return null

  const meta = user.user_metadata || {}
  const avatar = meta.avatar_url || meta.picture
  const name = meta.full_name || meta.name || user.email?.split('@')[0] || 'T'

  const onClick = () => {
    if (confirming) { signOut(); return }
    setConfirming(true)
    setTimeout(() => setConfirming(false), 2600)
  }

  return (
    <button onClick={onClick} title={confirming ? 'Tap again to sign out' : name}
      style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {confirming && <span style={{ fontSize: 10.5, color: 'var(--amber)' }}>Sign out?</span>}
      {avatar ? (
        <img src={avatar} alt="" referrerPolicy="no-referrer"
          style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(140deg,#2fd48a,#128a56)', color: '#04140d', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{name[0]?.toUpperCase()}</div>
      )}
    </button>
  )
}
