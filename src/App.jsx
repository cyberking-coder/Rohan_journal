import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Shell from './components/Shell'
import TradeForm from './components/TradeForm'
import CommandPalette from './components/CommandPalette'
import Dashboard from './pages/Dashboard'
import Journal from './pages/Journal'
import Analysis from './pages/Analysis'
import Tools from './pages/Tools'
import Trades from './pages/Trades'
import Settings from './pages/Settings'
import Market from './pages/Market'
import ComingSoon from './pages/ComingSoon'
import Login from './pages/Login'
import { useTrades } from './lib/useTrades'
import { useBrokerAccounts } from './lib/useBrokerAccounts'
import { useAuth } from './lib/AuthContext'
import { useView } from './lib/router'
import { getView } from './lib/views'

export default function App() {
  const { user, loading: authLoading, requiresAuth } = useAuth()

  if (authLoading) return <FullScreenLoader />
  if (requiresAuth && !user) return <Login />

  return <Journalized userId={user?.id ?? null} />
}

function Journalized({ userId }) {
  const [view, navigate] = useView()
  const [formOpen, setFormOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const { trades, loading, error, addTrade, updateTrade, deleteTrade, clearAllTrades, isSupabaseConfigured } = useTrades(userId)
  const brokerAccounts = useBrokerAccounts(userId)

  const openForm = useCallback(() => { setEditing(null); setFormOpen(true) }, [])
  const openEdit = (trade) => { setEditing(trade); setFormOpen(true) }
  const submitTrade = (record) => (editing ? updateTrade(editing.id, record) : addTrade(record))

  // ⌘K / Ctrl-K opens the palette from anywhere.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const current = getView(view)

  return (
    <Shell
      active={view}
      onNav={navigate}
      onAdd={openForm}
      onSearch={() => setPaletteOpen(true)}
      isDemo={!isSupabaseConfigured}
    >
      {error && (
        <div style={{
          marginBottom: 16, padding: '12px 16px', borderRadius: 12, fontSize: 13,
          background: 'rgba(255,107,107,0.09)', border: '1px solid rgba(255,107,107,0.3)', color: 'var(--red)',
        }}>
          Couldn't load your trades: {error}. Make sure the database schema has been applied in Supabase.
        </div>
      )}
      {loading ? (
        <LoadingState />
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
          >
            {view === 'dashboard' && <Dashboard trades={trades} onAdd={openForm} />}
            {view === 'journal' && <Journal trades={trades} onAdd={openForm} onUpdate={updateTrade} onEdit={openEdit} />}
            {view === 'trades' && <Trades trades={trades} onAdd={openForm} onDelete={deleteTrade} onEdit={openEdit} onClearAll={clearAllTrades} brokerAccounts={brokerAccounts} />}
            {view === 'analysis' && <Analysis trades={trades} />}
            {view === 'market' && <Market />}
            {view === 'tools' && <Tools />}
            {view === 'settings' && <Settings trades={trades} onClearAll={clearAllTrades} brokerAccounts={brokerAccounts} />}
            {!current?.ready && <ComingSoon view={current} />}
          </motion.div>
        </AnimatePresence>
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={navigate}
        onAdd={openForm}
      />

      <TradeForm open={formOpen} onClose={() => setFormOpen(false)} onSubmit={submitTrade} userId={userId} initial={editing} />
    </Shell>
  )
}

function FullScreenLoader() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
        style={{ width: 34, height: 34, borderRadius: '50%', border: '3px solid var(--stroke)', borderTopColor: 'var(--mint)' }}
      />
    </div>
  )
}

function LoadingState() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: i < 4 ? 96 : 220, gridColumn: i < 4 ? 'auto' : 'span 2' }} />
      ))}
    </div>
  )
}
