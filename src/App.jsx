import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Shell from './components/Shell'
import TradeForm from './components/TradeForm'
import Dashboard from './pages/Dashboard'
import Journal from './pages/Journal'
import Analysis from './pages/Analysis'
import Login from './pages/Login'
import { useTrades } from './lib/useTrades'
import { useAuth } from './lib/AuthContext'

export default function App() {
  const { user, loading: authLoading, requiresAuth } = useAuth()

  if (authLoading) return <FullScreenLoader />
  if (requiresAuth && !user) return <Login />

  return <Journalized userId={user?.id ?? null} />
}

function Journalized({ userId }) {
  const [page, setPage] = useState('dashboard')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const { trades, loading, error, addTrade, updateTrade, deleteTrade, isSupabaseConfigured } = useTrades(userId)

  const openForm = () => { setEditing(null); setFormOpen(true) }
  const openEdit = (trade) => { setEditing(trade); setFormOpen(true) }
  const submitTrade = (record) => (editing ? updateTrade(editing.id, record) : addTrade(record))

  return (
    <Shell active={page} onNav={setPage} onAdd={openForm} isDemo={!isSupabaseConfigured}>
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
            key={page}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
          >
            {page === 'dashboard' && <Dashboard trades={trades} onAdd={openForm} />}
            {page === 'journal' && <Journal trades={trades} onAdd={openForm} onDelete={deleteTrade} onEdit={openEdit} />}
            {page === 'analysis' && <Analysis trades={trades} />}
          </motion.div>
        </AnimatePresence>
      )}

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
        style={{ width: 34, height: 34, borderRadius: '50%', border: '3px solid #1c2523', borderTopColor: 'var(--mint)' }}
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
