import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { connectMetaApi } from '../lib/metaApiConnections'
import { useSubscription } from '../lib/billing'
import { limitsFor } from '../lib/plans'

// Modal-in-a-modal wrapper around the MetaApi connect flow, for surfaces
// outside Settings that want a "connect my broker" call to action — the
// Trades toolbar, the empty state, etc. Uses the same edge function as
// Settings so limits and encryption behave identically.

export default function ConnectBrokerModal({ open, onClose, onConnected }) {
  const [form, setForm] = useState({ label: '', broker: '', login: '', password: '', server: '', platform: 'mt5' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const { sub } = useSubscription()
  const plan = sub?.plan ?? 'free'
  const canCloudSync = limitsFor(plan).connectedAccounts > 0

  useEffect(() => {
    if (open) { setError(null); setBusy(false) }
  }, [open])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(null)
    const { data, error } = await connectMetaApi(form)
    setBusy(false)
    if (error) { setError(error); return }
    onConnected?.(data)
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '5vh 16px', overflowY: 'auto',
          }}
        >
          <motion.div
            className="card" onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
            style={{ padding: 24, width: '100%', maxWidth: 480 }}
          >
            <h3 style={{ fontFamily: 'var(--display)', fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
              Sync your MT4 / MT5 account
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 18, lineHeight: 1.6 }}>
              Trades stream into your journal automatically. Uses your <strong>investor</strong> password —
              read-only at the broker.
            </p>

            {!canCloudSync ? (
              <div style={{ padding: 16, borderRadius: 10, border: '1px solid var(--stroke)', background: 'var(--surface-2)' }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>Cloud sync is a Pro feature</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 14, lineHeight: 1.6 }}>
                  Automatic MT4 / MT5 sync is available on Pro and above.
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={onClose} style={ghostBtn}>Close</button>
                  <a href="?view=pricing" onClick={onClose} style={{
                    padding: '9px 16px', borderRadius: 10, textDecoration: 'none',
                    background: 'linear-gradient(135deg, #4c8dff, #2f6bd9)', color: '#fff',
                    fontSize: 13, fontWeight: 600,
                  }}>Upgrade to Pro</a>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
                <Field label="Broker">
                  <input value={form.broker} onChange={set('broker')} placeholder="FundingPips" />
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field label="Login (numeric)">
                    <input value={form.login} onChange={set('login')} inputMode="numeric" required />
                  </Field>
                  <Field label="Platform">
                    <select value={form.platform} onChange={set('platform')}>
                      <option value="mt5">MT5</option><option value="mt4">MT4</option>
                    </select>
                  </Field>
                </div>
                <Field label="Server">
                  <input value={form.server} onChange={set('server')} placeholder="FundingPips-Live" required />
                </Field>
                <Field label="Investor password">
                  <input value={form.password} onChange={set('password')} type="password" required />
                </Field>
                {error && (
                  <div style={{
                    padding: '9px 12px', borderRadius: 8, fontSize: 12.5,
                    background: 'rgba(255,107,107,0.09)', border: '1px solid rgba(255,107,107,0.3)', color: 'var(--red)',
                  }}>{error}</div>
                )}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                  <button type="button" onClick={onClose} style={ghostBtn}>Cancel</button>
                  <button type="submit" disabled={busy} className="btn-primary">
                    {busy ? 'Connecting…' : 'Connect'}
                  </button>
                </div>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
      {children}
    </label>
  )
}

const ghostBtn = {
  padding: '9px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 600,
  color: 'var(--text-2)', border: '1px solid var(--stroke)', background: 'transparent',
}
