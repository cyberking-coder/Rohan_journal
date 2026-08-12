import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../lib/AuthContext'
import { useTheme } from '../lib/theme'
import { getView } from '../lib/views'

// The global bar that sits above every page: section title, ⌘K search,
// theme toggle, quick-add, live clock, notifications and the profile menu.
export default function TopBar({ view, onSearch, onAdd, isDemo }) {
  const current = getView(view)
  const { theme, toggleTheme } = useTheme()
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 30,
      display: 'flex', alignItems: 'center', gap: 12,
      margin: '-24px -30px 22px', padding: '13px 30px',
      borderBottom: '1px solid var(--stroke)',
      background: 'var(--topbar-bg)', backdropFilter: 'blur(14px)',
    }} className="topbar">
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="eyebrow" style={{ fontSize: 10 }}>{isDemo ? 'Demo data' : 'Live'}</div>
        <div style={{ fontFamily: 'var(--display)', fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>
          {current?.label ?? 'Dashboard'}
        </div>
      </div>

      <button onClick={onSearch} className="hide-mobile" title="Search"
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px 8px 12px',
          borderRadius: 10, border: '1px solid var(--stroke)', background: 'var(--card)',
          color: 'var(--text-3)', fontSize: 12.5, minWidth: 190,
        }}>
        <span style={{ fontSize: 13 }}>⌕</span>
        <span style={{ flex: 1, textAlign: 'left' }}>Search…</span>
        <kbd style={{
          fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 5px', borderRadius: 4,
          border: '1px solid var(--stroke)', background: 'var(--card-2)',
        }}>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>

      <Clock />

      <IconButton label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme}>
        {theme === 'dark' ? '☾' : '☀'}
      </IconButton>

      <NotificationsBell />

      <motion.button whileTap={{ scale: 0.94 }} onClick={onAdd} title="Add trade"
        style={{
          width: 34, height: 34, borderRadius: 10, fontSize: 19, lineHeight: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(120deg, #3ee39a, #23b978)', color: '#04140d',
          boxShadow: '0 8px 20px -8px rgba(47,212,138,0.7)', flexShrink: 0,
        }}>+</motion.button>

      <ProfileMenu />
    </header>
  )
}

function IconButton({ children, label, onClick, badge }) {
  return (
    <button onClick={onClick} title={label} aria-label={label}
      style={{
        position: 'relative', width: 34, height: 34, borderRadius: 10, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15,
        border: '1px solid var(--stroke)', background: 'var(--card)', color: 'var(--text-2)',
      }}>
      {children}
      {badge > 0 && (
        <span style={{
          position: 'absolute', top: 5, right: 5, width: 6, height: 6,
          borderRadius: '50%', background: 'var(--mint)',
        }} />
      )}
    </button>
  )
}

// Live clock showing the browser's local time, matching the spec's top bar.
// Phase 4 points this at the user's saved timezone preference instead.
function Clock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone?.split('/').pop()?.replace(/_/g, ' ')

  return (
    // `.hide-mobile` sets inline-flex, which would lay the two lines out in a
    // row — the column direction has to be restated here.
    <div className="hide-mobile" style={{
      flexDirection: 'column', alignItems: 'flex-end',
      lineHeight: 1.2, flexShrink: 0, paddingRight: 2,
    }}>
      <div className="mono" style={{ fontSize: 13, fontWeight: 500, letterSpacing: '0.01em' }}>
        {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{zone || 'Local'}</div>
    </div>
  )
}

// The bell is wired up but has no source of notifications until trade alerts
// (Phase 4) and broker sync (Phase 5) exist, so it deliberately shows an
// empty state rather than fake activity.
function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useDismiss(ref, () => setOpen(false))

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <IconButton label="Notifications" onClick={() => setOpen((o) => !o)}>♪</IconButton>
      <AnimatePresence>
        {open && (
          <Dropdown>
            <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid var(--stroke)' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Notifications</div>
            </div>
            <div style={{ padding: '26px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12.5, lineHeight: 1.6 }}>
              You’re all caught up.<br />
              Trade alerts arrive once broker sync is connected.
            </div>
          </Dropdown>
        )}
      </AnimatePresence>
    </div>
  )
}

function ProfileMenu() {
  const { user, signOut, requiresAuth } = useAuth()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef(null)
  useDismiss(ref, () => setOpen(false))

  if (!requiresAuth || !user) return null

  const meta = user.user_metadata || {}
  const name = meta.full_name || meta.name || user.email?.split('@')[0] || 'Trader'
  const avatar = meta.avatar_url || meta.picture

  const copyId = () => {
    navigator.clipboard?.writeText(user.id).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button onClick={() => setOpen((o) => !o)} title={name} aria-label="Account menu"
        style={{ display: 'block', borderRadius: '50%' }}>
        {avatar ? (
          <img src={avatar} alt="" referrerPolicy="no-referrer"
            style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{
            width: 34, height: 34, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(140deg,#2fd48a,#128a56)', color: '#04140d',
            fontWeight: 700, fontSize: 14,
          }}>{name[0]?.toUpperCase()}</div>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <Dropdown>
            <div style={{ padding: '13px 14px', borderBottom: '1px solid var(--stroke)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</div>
            </div>
            <div style={{ padding: 6 }}>
              <MenuItem onClick={copyId}>
                {copied ? '✓ Account ID copied' : `Copy account ID · ${user.id.slice(0, 8)}…`}
              </MenuItem>
              <MenuItem onClick={signOut}>Sign out</MenuItem>
            </div>
          </Dropdown>
        )}
      </AnimatePresence>
    </div>
  )
}

function MenuItem({ children, onClick }) {
  return (
    <button onClick={onClick}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--card-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      style={{
        width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: 8,
        fontSize: 12.5, color: 'var(--text-2)', transition: 'background 0.15s',
      }}>{children}</button>
  )
}

function Dropdown({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.99 }}
      transition={{ duration: 0.14 }}
      style={{
        position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 246, zIndex: 50,
        background: 'var(--card)', border: '1px solid var(--stroke)',
        borderRadius: 13, boxShadow: 'var(--shadow)', overflow: 'hidden',
      }}
    >{children}</motion.div>
  )
}

// Closes a popover on outside click or Escape.
function useDismiss(ref, close) {
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) close() }
    const onKey = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [ref, close])
}
