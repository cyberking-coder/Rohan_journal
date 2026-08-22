import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Sensitive } from './Money'
import { usePrefs } from '../lib/theme'
import { formatMoney } from '../lib/format'
import { fmtPct } from '../lib/stats'
import {
  PLATFORMS, combineAccounts, displayName, fmtRelative, platformLabel,
  syncStatus, validateAccount,
} from '../lib/brokerAccounts'

const TONE_COLOR = {
  good: 'var(--mint)',
  neutral: 'var(--amber)',
  bad: 'var(--red)',
  muted: 'var(--text-3)',
}

// The account manager shown in Settings → MT5 / MT4.
export default function BrokerAccounts({ accounts, trades, onAdd, onUpdate, onRemove }) {
  const { currency } = usePrefs()
  const [revealed, setRevealed] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(null)

  const combined = useMemo(() => combineAccounts(accounts, trades), [accounts, trades])
  const derivedCount = combined.filter((a) => a.derived).length

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={() => { setEditing(null); setAdding(true) }} style={primaryButton}>+ Add account</button>
        <button onClick={() => setRevealed((r) => !r)} style={ghost}>
          {revealed ? 'Hide numbers' : 'Reveal numbers'}
        </button>
      </div>

      {combined.length === 0 && (
        <Empty>No accounts yet. Add one to group your trades, or log a trade and one will be inferred.</Empty>
      )}

      {combined.map((a) => (
        <AccountCard
          key={a.id} account={a} revealed={revealed} currency={currency}
          onEdit={() => { setAdding(false); setEditing(a) }}
          onToggleFavorite={() => onUpdate(a.id, { is_favorite: !a.is_favorite })}
          onToggleActive={() => onUpdate(a.id, { is_active: a.is_active === false })}
          onRemove={() => setConfirmRemove(a)}
        />
      ))}

      {derivedCount > 0 && (
        <Note>
          {derivedCount === 1 ? 'One group is' : `${derivedCount} groups are`} inferred from the
          trade source rather than registered. Registering them lets you name them, track sync
          status, and keep several accounts on the same platform apart.
        </Note>
      )}

      <AnimatePresence>
        {(adding || editing) && (
          <AccountDialog
            initial={editing}
            onCancel={() => { setAdding(false); setEditing(null) }}
            onSave={async (values) => {
              const res = editing ? await onUpdate(editing.id, values) : await onAdd(values)
              if (!res?.error) { setAdding(false); setEditing(null) }
              return res
            }}
          />
        )}
        {confirmRemove && (
          <RemoveDialog
            account={confirmRemove}
            onCancel={() => setConfirmRemove(null)}
            onConfirm={async () => { await onRemove(confirmRemove.id); setConfirmRemove(null) }}
          />
        )}
      </AnimatePresence>
    </>
  )
}

function AccountCard({ account: a, revealed, currency, onEdit, onToggleFavorite, onToggleActive, onRemove }) {
  const status = syncStatus(a)
  const color = TONE_COLOR[status.tone] ?? 'var(--text-3)'
  const inactive = a.is_active === false

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      style={{
        padding: 16, borderRadius: 12, marginBottom: 10,
        background: 'var(--card-2)', border: '1px solid var(--stroke)',
        opacity: inactive ? 0.6 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {a.is_favorite && <span style={{ color: 'var(--amber)', fontSize: 13 }} title="Favourite">★</span>}
        <span style={{ fontSize: 14, fontWeight: 600 }}>{displayName(a, revealed)}</span>
        {/* A derived group is named after its platform, so repeating it reads
            as a duplicate rather than as extra information. */}
        {a.label !== platformLabel(a.platform) && (
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{platformLabel(a.platform)}</span>
        )}

        <span title={status.detail}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em',
            padding: '3px 7px', borderRadius: 5, color, border: `1px solid ${color}`,
          }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: color }} />
          {status.label.toUpperCase()}
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
          {!a.derived && (
            <>
              <IconButton title={a.is_favorite ? 'Unfavourite' : 'Favourite'} onClick={onToggleFavorite}>
                {a.is_favorite ? '★' : '☆'}
              </IconButton>
              <IconButton title="Edit" onClick={onEdit}>✎</IconButton>
              <IconButton title={inactive ? 'Reconnect' : 'Disconnect'} onClick={onToggleActive}>
                {inactive ? '⟲' : '⏻'}
              </IconButton>
              <IconButton title="Remove account" onClick={onRemove}>✕</IconButton>
            </>
          )}
        </div>
      </div>

      {status.detail && (
        <div style={{ fontSize: 11, color: status.tone === 'bad' ? 'var(--red)' : 'var(--text-3)', marginTop: 7, lineHeight: 1.5 }}>
          {status.detail}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))', gap: 12, marginTop: 13 }}>
        <Mini label="Total P&L" value={
          <Sensitive style={{ color: a.pnl >= 0 ? 'var(--mint)' : 'var(--red)' }}>
            {formatMoney(a.pnl, { currency })}
          </Sensitive>} />
        <Mini label="Trades" value={a.trades} />
        <Mini label="Win Rate" value={a.trades ? fmtPct(a.winRate, 1) : '—'} />
        <Mini label="Open" value={a.open ? (
          <>
            {a.open}{' '}
            <Sensitive style={{ fontSize: 11, color: a.floating >= 0 ? 'var(--mint)' : 'var(--red)' }}>
              ({formatMoney(a.floating, { currency: a.currency || currency, digits: 0 })})
            </Sensitive>
          </>
        ) : 0} />
        <Mini label="Last Sync" value={a.derived ? '—' : fmtRelative(a.last_synced_at)} />
      </div>

      {/* Balance and equity come from the broker, so they only exist once the
          bridge has reported. Absent is shown as absent rather than as $0 —
          a zero balance is a real and alarming thing to tell someone. */}
      {(a.balance != null || a.equity != null) && (
        <div style={{
          display: 'flex', gap: 18, marginTop: 13, paddingTop: 13,
          borderTop: '1px solid var(--stroke)', flexWrap: 'wrap', alignItems: 'baseline',
        }}>
          <Mini label="Balance" value={
            <Sensitive>{a.balance != null ? formatMoney(a.balance, { currency: a.currency || currency }) : '—'}</Sensitive>} />
          <Mini label="Equity" value={
            <Sensitive style={{ color: a.equity != null && a.balance != null
              ? (a.equity >= a.balance ? 'var(--mint)' : 'var(--red)') : undefined }}>
              {a.equity != null ? formatMoney(a.equity, { currency: a.currency || currency }) : '—'}
            </Sensitive>} />
          {a.leverage ? <Mini label="Leverage" value={`1:${a.leverage}`} /> : null}
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-3)' }}>
            as of {fmtRelative(a.state_at)}
          </span>
        </div>
      )}
    </motion.div>
  )
}

function AccountDialog({ initial, onCancel, onSave }) {
  const [values, setValues] = useState(() => ({
    label: initial?.label ?? '',
    broker: initial?.broker ?? '',
    account_number: initial?.account_number ?? '',
    platform: initial?.platform ?? 'mt5',
    currency: initial?.currency ?? 'USD',
  }))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(null)

  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }))

  const submit = async () => {
    const { valid, errors: errs } = validateAccount(values)
    setErrors(errs)
    if (!valid) return
    setSaving(true)
    setFailed(null)
    const res = await onSave({
      ...values,
      account_number: values.account_number.trim() || null,
      broker: values.broker.trim() || null,
    })
    setSaving(false)
    if (res?.error) setFailed(res.error.message || 'Could not save the account.')
  }

  return (
    <Overlay onCancel={onCancel}>
      <h3 style={{ fontFamily: 'var(--display)', fontSize: 17, fontWeight: 700, marginBottom: 4 }}>
        {initial ? 'Edit account' : 'Add account'}
      </h3>
      <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 16 }}>
        This records which account a trade belongs to. No password is asked for or
        stored here — the sync bridge runs on your own machine, and where it does log
        in, it uses your broker’s read-only investor credential.
      </p>

      <Field label="Name" error={errors.label}>
        <input value={values.label} onChange={set('label')} autoFocus
          placeholder="FundingPips Challenge" style={control} />
      </Field>
      <Field label="Broker or firm">
        <input value={values.broker} onChange={set('broker')} placeholder="FundingPips" style={control} />
      </Field>
      <Field label="Account number" error={errors.account_number}
        hint="Optional. Masked on screen unless you reveal it.">
        <input value={values.account_number} onChange={set('account_number')}
          placeholder="20555917" style={control} />
      </Field>
      <Field label="Platform">
        <select value={values.platform} onChange={set('platform')} style={control}>
          {Object.entries(PLATFORMS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </Field>

      {failed && (
        <div style={{
          marginTop: 12, padding: '9px 12px', borderRadius: 9, fontSize: 12,
          background: 'rgba(255,107,107,0.09)', border: '1px solid rgba(255,107,107,0.3)', color: 'var(--red)',
        }}>{failed}</div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
        <button onClick={onCancel} style={ghost}>Cancel</button>
        <button onClick={submit} disabled={saving} style={primaryButton}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Add account'}
        </button>
      </div>
    </Overlay>
  )
}

function RemoveDialog({ account, onCancel, onConfirm }) {
  const [working, setWorking] = useState(false)
  return (
    <Overlay onCancel={onCancel} danger>
      <h3 style={{ fontFamily: 'var(--display)', fontSize: 17, fontWeight: 700, color: 'var(--red)' }}>
        Remove “{account.label}”?
      </h3>
      <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.65, margin: '10px 0 18px' }}>
        {account.trades > 0 ? (
          <>
            Its <strong>{account.trades + (account.open || 0)}</strong>{' '}
            {account.trades + (account.open || 0) === 1 ? 'trade stays' : 'trades stay'} in your journal and become
            unattributed — nothing is deleted. You can register the account again later.
          </>
        ) : 'This account has no trades yet.'}
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={ghost}>Cancel</button>
        <button disabled={working}
          onClick={async () => { setWorking(true); await onConfirm() }}
          style={{ ...primaryButton, background: 'var(--red)', color: '#fff' }}>
          {working ? 'Removing…' : 'Remove account'}
        </button>
      </div>
    </Overlay>
  )
}

function Overlay({ children, onCancel, danger }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 70, padding: 20,
        background: 'rgba(4,7,6,0.7)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.99 }} onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto', padding: 24,
          borderRadius: 16, background: 'var(--card)', boxShadow: 'var(--shadow)',
          border: `1px solid ${danger ? 'rgba(255,107,107,0.3)' : 'var(--stroke)'}`,
        }}>{children}</motion.div>
    </motion.div>
  )
}

function Field({ label, hint, error, children }) {
  return (
    <div style={{ marginBottom: 13 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>{label}</label>
      {children}
      {hint && !error && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 5 }}>{hint}</div>}
      {error && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 5 }}>{error}</div>}
    </div>
  )
}

function IconButton({ children, title, onClick }) {
  return (
    <button onClick={onClick} title={title}
      style={{ color: 'var(--text-3)', fontSize: 13, padding: '5px 7px', borderRadius: 6 }}>{children}</button>
  )
}

function Mini({ label, value }) {
  return (
    <div>
      <div className="eyebrow" style={{ fontSize: 9 }}>{label}</div>
      <div className="mono" style={{ fontSize: 13.5, fontWeight: 600, marginTop: 3 }}>{value}</div>
    </div>
  )
}

function Empty({ children }) {
  return (
    <div style={{
      padding: '20px 16px', borderRadius: 11, fontSize: 12.5, lineHeight: 1.7,
      color: 'var(--text-3)', background: 'var(--card-2)', border: '1px solid var(--stroke)',
    }}>{children}</div>
  )
}

function Note({ children }) {
  return <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.65, marginTop: 14 }}>{children}</p>
}

const control = {
  width: '100%', padding: '9px 12px', borderRadius: 10, fontSize: 13,
  background: 'var(--input-bg)', border: '1px solid var(--stroke)',
  color: 'var(--text)', outline: 'none',
}

const ghost = {
  padding: '8px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 600,
  color: 'var(--text-2)', border: '1px solid var(--stroke)', background: 'var(--card-2)',
}

const primaryButton = {
  padding: '8px 16px', borderRadius: 10, fontSize: 12.5, fontWeight: 600,
  background: 'linear-gradient(120deg,#3ee39a,#23b978)', color: '#04140d',
}
