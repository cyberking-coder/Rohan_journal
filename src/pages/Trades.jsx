import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { PageHeader } from '../components/common'
import TradeHistoryTable from '../components/TradeHistoryTable'
import {
  ALL_ACCOUNTS, accountSummary, buildAccounts, filterByAccount, maskIdentifier,
} from '../lib/accounts'
import { fmtPct } from '../lib/stats'
import Money from '../components/Money'

export default function Trades({ trades, onAdd, onDelete, onEdit, onClearAll }) {
  const [accountId, setAccountId] = useState(ALL_ACCOUNTS)
  const [revealed, setRevealed] = useState(false)
  const [side, setSide] = useState('All')
  const [query, setQuery] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  const accounts = useMemo(() => buildAccounts(trades), [trades])
  const scoped = useMemo(() => filterByAccount(trades, accountId), [trades, accountId])

  const rows = useMemo(() => scoped.filter((t) => {
    if (side !== 'All' && t.side !== side) return false
    if (!query.trim()) return true
    const hay = `${t.symbol} ${t.strategy ?? ''} ${t.session ?? ''}`.toLowerCase()
    return hay.includes(query.trim().toLowerCase())
  }), [scoped, side, query])

  const summary = useMemo(() => accountSummary(scoped), [scoped])
  const filtersActive = side !== 'All' || query.trim() !== ''

  return (
    <>
      <PageHeader eyebrow="Portfolio" title="Trades">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={onAdd}
            style={{
              padding: '10px 18px', borderRadius: 11, fontWeight: 600, fontSize: 14,
              background: 'linear-gradient(120deg,#3ee39a,#23b978)', color: '#04140d',
            }}>+ Add Trade</button>
        </div>
      </PageHeader>

      {/* Account switcher */}
      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--card-2)', borderRadius: 10, padding: 3, flexWrap: 'wrap' }}>
            <AccountPill
              label="All accounts" active={accountId === ALL_ACCOUNTS}
              onClick={() => setAccountId(ALL_ACCOUNTS)} count={trades.length}
            />
            {accounts.map((a) => (
              <AccountPill
                key={a.id} active={accountId === a.id} count={a.trades}
                onClick={() => setAccountId(a.id)}
                label={revealed ? a.label : maskIdentifier(a.label)}
                synced={a.synced}
              />
            ))}
          </div>

          <button onClick={() => setRevealed((r) => !r)}
            title={revealed ? 'Hide account identifiers' : 'Reveal account identifiers'}
            style={{
              width: 32, height: 32, borderRadius: 9, flexShrink: 0, fontSize: 13,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid var(--stroke)', background: 'var(--card-2)', color: 'var(--text-3)',
            }}>{revealed ? '◉' : '◎'}</button>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* Sync and Disconnect need the broker bridge, which is phase 5.
                Shown disabled rather than as buttons that do nothing. */}
            <DisabledAction label="Sync" title="Broker sync arrives in phase 5" />
            <DisabledAction label="Disconnect" title="Broker connections arrive in phase 5" />
            <button onClick={() => setConfirmClear(true)} disabled={!trades.length}
              style={{
                ...ghostButton,
                color: trades.length ? 'var(--red)' : 'var(--text-3)',
                borderColor: trades.length ? 'rgba(255,107,107,0.3)' : 'var(--stroke)',
                cursor: trades.length ? 'pointer' : 'not-allowed',
              }}>Clear All</button>
          </div>
        </div>

        {/* Per-account summary strip */}
        <div className="account-summary">
          <Summary label="Total P&L" value={<Money value={summary.pnl} colored />} />
          <Summary label="Trades" value={summary.trades} />
          <Summary label="Win Rate" value={fmtPct(summary.winRate, 1)} />
          <Summary label="Open Positions" value={summary.open} />
          <Summary label="Last Activity"
            value={summary.lastAt
              ? new Date(summary.lastAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
              : 'None'} />
        </div>
      </div>

      {/* History */}
      <section className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <h3 style={{ fontFamily: 'var(--display)', fontSize: 15.5, fontWeight: 600 }}>Trade History</h3>
          <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
            {rows.length} of {scoped.length} trades
          </span>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {filtersActive && (
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--mint)' }}
                title="Filters active" />
            )}
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search symbol…"
              style={{ ...control, width: 160 }} />
            <select value={side} onChange={(e) => setSide(e.target.value)} style={control}>
              <option>All</option><option>Long</option><option>Short</option>
            </select>
          </div>
        </div>

        <TradeHistoryTable trades={rows} onDelete={onDelete} onEdit={onEdit} />
      </section>

      <AnimatePresence>
        {confirmClear && (
          <ClearAllDialog
            count={trades.length}
            onCancel={() => setConfirmClear(false)}
            onConfirm={async () => { await onClearAll?.(); setConfirmClear(false) }}
          />
        )}
      </AnimatePresence>
    </>
  )
}

function AccountPill({ label, count, active, synced, onClick }) {
  return (
    <button onClick={onClick}
      style={{
        padding: '7px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: 7,
        background: active ? 'var(--card-hover)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--text-3)',
      }}>
      {synced && <span style={{ color: 'var(--mint)', fontSize: 8 }}>●</span>}
      {label}
      <span className="mono" style={{
        fontSize: 10, padding: '1px 5px', borderRadius: 5,
        background: 'var(--track)', color: 'var(--text-3)',
      }}>{count}</span>
    </button>
  )
}

function DisabledAction({ label, title }) {
  return (
    <button disabled title={title}
      style={{ ...ghostButton, color: 'var(--text-3)', cursor: 'not-allowed', opacity: 0.6 }}>
      {label}
    </button>
  )
}

function Summary({ label, value, accent }) {
  return (
    <div>
      <div className="eyebrow" style={{ fontSize: 9.5 }}>{label}</div>
      <div className="mono" style={{ fontSize: 16, fontWeight: 600, marginTop: 4, color: accent || 'var(--text)' }}>{value}</div>
    </div>
  )
}

function ClearAllDialog({ count, onCancel, onConfirm }) {
  const [typed, setTyped] = useState('')
  const [working, setWorking] = useState(false)
  // Deleting every trade is unrecoverable, so it takes a deliberate action
  // rather than a single click.
  const armed = typed.trim().toUpperCase() === 'DELETE'

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 80, padding: 20,
        background: 'rgba(4,7,6,0.7)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.99 }} onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 420, padding: 24, borderRadius: 16,
          background: 'var(--card)', border: '1px solid rgba(255,107,107,0.3)', boxShadow: 'var(--shadow)',
        }}>
        <h3 style={{ fontFamily: 'var(--display)', fontSize: 17, fontWeight: 700, color: 'var(--red)' }}>
          Delete all {count} trades?
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.65, margin: '10px 0 16px' }}>
          This permanently removes every trade and its journal entry. It cannot be undone,
          and synced trades will not come back until you re-import them.
        </p>
        <label style={{ fontSize: 11.5, color: 'var(--text-3)', display: 'block', marginBottom: 7 }}>
          Type <span className="mono" style={{ color: 'var(--red)' }}>DELETE</span> to confirm
        </label>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus
          style={{ ...control, width: '100%', marginBottom: 16 }} />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ ...ghostButton, padding: '9px 16px' }}>Cancel</button>
          <button
            disabled={!armed || working}
            onClick={async () => { setWorking(true); await onConfirm() }}
            style={{
              padding: '9px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600,
              background: armed ? 'var(--red)' : 'var(--card-2)',
              color: armed ? '#fff' : 'var(--text-3)',
              border: armed ? 'none' : '1px solid var(--stroke)',
              cursor: armed && !working ? 'pointer' : 'not-allowed',
            }}>{working ? 'Deleting…' : 'Delete everything'}</button>
        </div>
      </motion.div>
    </motion.div>
  )
}

const control = {
  padding: '8px 12px', borderRadius: 10, fontSize: 13,
  background: 'var(--input-bg)', border: '1px solid var(--stroke)',
  color: 'var(--text)', outline: 'none',
}

const ghostButton = {
  padding: '8px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 600,
  color: 'var(--text-2)', border: '1px solid var(--stroke)', background: 'var(--card-2)',
}
