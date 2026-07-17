import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Shell from './components/Shell'
import TradeForm from './components/TradeForm'
import Dashboard from './pages/Dashboard'
import Journal from './pages/Journal'
import Analysis from './pages/Analysis'
import { useTrades } from './lib/useTrades'

export default function App() {
  const [page, setPage] = useState('dashboard')
  const [formOpen, setFormOpen] = useState(false)
  const { trades, loading, addTrade, deleteTrade, isSupabaseConfigured } = useTrades()

  const openForm = () => setFormOpen(true)

  return (
    <Shell active={page} onNav={setPage} onAdd={openForm} isDemo={!isSupabaseConfigured}>
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
            {page === 'journal' && <Journal trades={trades} onAdd={openForm} onDelete={deleteTrade} />}
            {page === 'analysis' && <Analysis trades={trades} />}
          </motion.div>
        </AnimatePresence>
      )}

      <TradeForm open={formOpen} onClose={() => setFormOpen(false)} onSubmit={addTrade} />
    </Shell>
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
