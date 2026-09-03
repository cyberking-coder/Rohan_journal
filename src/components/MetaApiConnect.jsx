import { useCallback, useEffect, useState } from 'react'
import {
  connectMetaApi,
  disconnectMetaApi,
  listMetaApiConnections,
} from '../lib/metaApiConnections'
import { useSubscription } from '../lib/billing'
import { limitsFor } from '../lib/plans'

// Settings → Accounts card that lets the user connect a broker account via
// MetaApi.cloud. The MetaApi token and encryption key live server-side; the
// browser only ever posts (login, investor password, server) to the edge
// function and lists connections through a security-definer RPC.

const STATUS_TONE = {
  provisioning: { label: 'Provisioning…', tone: 'var(--amber)' },
  deploying:    { label: 'Deploying…',    tone: 'var(--amber)' },
  connected:    { label: 'Connected',     tone: 'var(--mint)' },
  error:        { label: 'Error',         tone: 'var(--red)' },
  disconnected: { label: 'Disconnected',  tone: 'var(--text-3)' },
}

export default function MetaApiConnect() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState(null)
  const { sub } = useSubscription()
  const limits = limitsFor(sub?.plan ?? 'free')
  const cap = limits.connectedAccounts
  const atCap = rows.length >= cap
  const gated = cap === 0

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data, error } = await listMetaApiConnections()
    setRows(data)
    setError(error)
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Poll while any row is still being provisioned/deployed so the status
  // catches up without needing a page refresh.
  useEffect(() => {
    const pending = rows.some((r) => r.status === 'provisioning' || r.status === 'deploying')
    if (!pending) return
    const id = setInterval(refresh, 15000)
    return () => clearInterval(id)
  }, [rows, refresh])

  return (
    <div style={{ marginTop: 24, padding: 18, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--stroke)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Cloud auto-sync (MetaApi)</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 2 }}>
            Sync a broker account from the cloud — no software to install. Uses your <strong>investor</strong> password (read-only at the broker).
          </div>
        </div>
        {!adding && !gated && !atCap && (
          <button onClick={() => setAdding(true)} style={primaryButton}>+ Connect</button>
        )}
        {!adding && gated && (
          <a href="?view=pricing" style={{ ...primaryButton, textDecoration: 'none' }}>Upgrade to Pro</a>
        )}
        {!adding && !gated && atCap && (
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {cap === Infinity ? '' : `${cap}/${cap} connections used`}
          </span>
        )}
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {adding && <ConnectForm onCancel={() => setAdding(false)} onDone={() => { setAdding(false); refresh() }} />}

      {!loading && rows.length === 0 && !adding && (
        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-3)' }}>No cloud connections yet.</div>
      )}

      {rows.map((r) => (
        <ConnectionCard key={r.id} row={r} onRemove={async () => {
          const { error } = await disconnectMetaApi(r.id)
          if (error) setError(error)
          refresh()
        }} />
      ))}
    </div>
  )
}

function ConnectForm({ onCancel, onDone }) {
  const [form, setForm] = useState({ label: '', broker: '', login: '', password: '', server: '', platform: 'mt5' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(null)
    const { error } = await connectMetaApi(form)
    setBusy(false)
    if (error) setError(error); else onDone()
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 14, display: 'grid', gap: 10 }}>
      <Field label="Label"><input value={form.label} onChange={set('label')} placeholder="FundingPips Challenge #2" style={input} /></Field>
      <Field label="Broker (as shown in MT5)"><input value={form.broker} onChange={set('broker')} placeholder="FundingPips" style={input} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Login (numeric)"><input value={form.login} onChange={set('login')} inputMode="numeric" required style={input} /></Field>
        <Field label="Platform">
          <select value={form.platform} onChange={set('platform')} style={input}>
            <option value="mt5">MT5</option>
            <option value="mt4">MT4</option>
          </select>
        </Field>
      </div>
      <Field label="Server"><input value={form.server} onChange={set('server')} placeholder="FundingPips-Live" required style={input} /></Field>
      <Field label="Investor password"><input value={form.password} onChange={set('password')} type="password" required style={input} /></Field>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={busy} style={primaryButton}>{busy ? 'Connecting…' : 'Connect'}</button>
        <button type="button" onClick={onCancel} style={ghost}>Cancel</button>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
        The password is sent once over TLS, encrypted server-side (AES-256-GCM) and never returned to the browser.
      </div>
    </form>
  )
}

function ConnectionCard({ row, onRemove }) {
  const s = STATUS_TONE[row.status] ?? { label: row.status, tone: 'var(--text-3)' }
  return (
    <div style={{ marginTop: 12, padding: 12, borderRadius: 10, border: '1px solid var(--stroke)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>
          {row.platform.toUpperCase()} · {row.mt5_login} <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>@ {row.mt5_server}</span>
        </div>
        <div style={{ fontSize: 12, color: s.tone, marginTop: 2 }}>
          {s.label}{row.last_error ? ` — ${row.last_error}` : ''}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>
          Last sync: {row.last_synced_at ? new Date(row.last_synced_at).toLocaleString() : 'never'}
        </div>
      </div>
      <button onClick={onRemove} style={ghost}>Disconnect</button>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 11.5, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
      {children}
    </label>
  )
}

function ErrorBanner({ children }) {
  return (
    <div style={{
      marginTop: 10, padding: '9px 12px', borderRadius: 8, fontSize: 12.5,
      background: 'rgba(255,107,107,0.09)', border: '1px solid rgba(255,107,107,0.3)', color: 'var(--red)',
    }}>{children}</div>
  )
}

const input = {
  padding: '9px 11px', borderRadius: 8, border: '1px solid var(--stroke)',
  background: 'var(--surface)', color: 'var(--text-1)', fontSize: 13,
}
const primaryButton = {
  padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
  background: 'var(--mint)', color: '#001512', fontWeight: 600, fontSize: 13,
}
const ghost = {
  padding: '8px 12px', borderRadius: 8, background: 'transparent',
  border: '1px solid var(--stroke)', color: 'var(--text-2)', fontSize: 13, cursor: 'pointer',
}
