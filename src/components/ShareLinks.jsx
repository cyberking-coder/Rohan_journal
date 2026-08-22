import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useShares } from '../lib/useShares'
import {
  DEFAULT_SECTIONS, EXPIRY_OPTIONS, SHARE_SECTIONS, sectionLabels,
  shareStatus, shareUrl, shareWarnings,
} from '../lib/sharing'

/**
 * Create and revoke read-only share links.
 *
 * The design principle here is that the consequence should be visible at the
 * moment of the decision. Sharing a dashboard is easy to think of as "showing
 * my results" and easy to actually be "publishing my private notes to anyone
 * holding a URL, forever" — so the warnings appear next to the button, before
 * the link exists, not in documentation nobody reads.
 */
export default function ShareLinks({ userId, accounts = [] }) {
  const { shares, loading, ready, error, create, revoke, remove, clearError } = useShares(userId)
  const [open, setOpen] = useState(false)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <motion.button whileTap={{ scale: 0.97 }} onClick={() => setOpen((o) => !o)}
          style={{
            padding: '9px 16px', borderRadius: 10, fontWeight: 600, fontSize: 13,
            background: open ? 'var(--card-2)' : 'linear-gradient(120deg, #3ee39a, #23b978)',
            color: open ? 'var(--text-2)' : '#04140d',
            border: open ? '1px solid var(--stroke)' : 'none',
          }}>{open ? 'Cancel' : '+ New share link'}</motion.button>

        {shares.length > 0 && (
          <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
            {shares.filter((s) => shareStatus(s).key === 'live').length} live ·{' '}
            {shares.length} total
          </span>
        )}
      </div>

      {error && (
        <div onClick={clearError} style={{
          marginBottom: 12, padding: '10px 13px', borderRadius: 10, fontSize: 12.5, cursor: 'pointer',
          background: 'rgba(255,107,107,0.09)', border: '1px solid rgba(255,107,107,0.3)', color: 'var(--red)',
        }}>{error}</div>
      )}

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
            <CreateForm accounts={accounts} onCancel={() => setOpen(false)}
              onCreate={async (values) => {
                const made = await create(values)
                if (made) setOpen(false)
              }} />
          </motion.div>
        )}
      </AnimatePresence>

      {!loading && !ready && (
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.6, padding: '10px 0' }}>
          Sharing isn’t set up yet — run <code className="mono">supabase/phase9.sql</code> in the SQL editor.
        </div>
      )}

      {ready && shares.length === 0 && !open && (
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.6 }}>
          No share links yet. A link gives read-only access to whichever sections you pick —
          useful for a prop firm, a mentor, or an audience — and you can revoke it at any time.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {shares.map((s) => (
          <ShareRow key={s.id} share={s} onRevoke={() => revoke(s.id)} onRemove={() => remove(s.id)} />
        ))}
      </div>
    </div>
  )
}

function CreateForm({ accounts, onCreate, onCancel }) {
  const [label, setLabel] = useState('')
  const [sections, setSections] = useState(DEFAULT_SECTIONS)
  const [accountScope, setAccountScope] = useState('')
  const [hideAmounts, setHideAmounts] = useState(false)
  const [expiry, setExpiry] = useState('7d')
  const [busy, setBusy] = useState(false)

  const warnings = shareWarnings({ sections, expiry, hideAmounts })
  const toggle = (key) => setSections((prev) =>
    prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key])

  return (
    <div style={{
      padding: 16, borderRadius: 12, background: 'var(--card-2)',
      border: '1px solid var(--stroke)', marginBottom: 14,
    }}>
      <Field label="Name it (only you see this)">
        <input value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="FundingPips review" style={control} />
      </Field>

      <div style={{ margin: '14px 0 6px', fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
        What the viewer gets
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {SHARE_SECTIONS.map((s) => (
          <label key={s.key} style={{
            display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 11px',
            borderRadius: 9, background: 'var(--card)', cursor: 'pointer',
            border: `1px solid ${sections.includes(s.key) ? 'var(--mint)' : 'var(--stroke)'}`,
          }}>
            <input type="checkbox" checked={sections.includes(s.key)} onChange={() => toggle(s.key)}
              style={{ marginTop: 2, accentColor: 'var(--mint)' }} />
            <span>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{s.label}</span>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                {s.description}
              </span>
              {s.caution && sections.includes(s.key) && (
                <span style={{ display: 'block', fontSize: 11, color: 'var(--amber)', marginTop: 3 }}>
                  {s.caution}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 14 }}>
        <Field label="Accounts">
          <select value={accountScope} onChange={(e) => setAccountScope(e.target.value)} style={control}>
            <option value="">All accounts</option>
            {accounts.filter((a) => !a.derived).map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Expires">
          <select value={expiry} onChange={(e) => setExpiry(e.target.value)} style={control}>
            {EXPIRY_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </Field>
      </div>

      <label style={{
        display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 12,
        padding: '10px 12px', borderRadius: 9, background: 'var(--card)', cursor: 'pointer',
      }}>
        <input type="checkbox" checked={hideAmounts} onChange={(e) => setHideAmounts(e.target.checked)}
          style={{ marginTop: 2, accentColor: 'var(--mint)' }} />
        <span>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Hide money amounts</span>
          <span style={{ display: 'block', fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
            Show results as R multiples instead of currency. Your win rate, consistency and
            drawdown are all still visible — your account size isn’t.
          </span>
        </span>
      </label>

      {warnings.length > 0 && (
        <div style={{
          marginTop: 14, padding: '11px 13px', borderRadius: 10, fontSize: 11.5, lineHeight: 1.6,
          background: 'rgba(240,178,74,0.08)', border: '1px solid rgba(240,178,74,0.28)',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          {warnings.map((w) => <span key={w} style={{ color: 'var(--text-2)' }}>{w}</span>)}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <motion.button whileTap={{ scale: 0.97 }} disabled={busy || !sections.length}
          onClick={async () => { setBusy(true); await onCreate({ label, sections, accountScope, hideAmounts, expiry }); setBusy(false) }}
          style={{
            padding: '9px 18px', borderRadius: 10, fontWeight: 600, fontSize: 13,
            background: sections.length ? 'linear-gradient(120deg, #3ee39a, #23b978)' : 'var(--card)',
            color: sections.length ? '#04140d' : 'var(--text-3)',
            cursor: sections.length ? 'pointer' : 'not-allowed',
          }}>{busy ? 'Creating…' : 'Create link'}</motion.button>
        <button onClick={onCancel} style={{ fontSize: 12.5, color: 'var(--text-3)', padding: '9px 12px' }}>Cancel</button>
      </div>
    </div>
  )
}

function ShareRow({ share, onRevoke, onRemove }) {
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const status = shareStatus(share)
  const url = shareUrl(share.code)
  const live = status.key === 'live' || status.key === 'expiring'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard access can be refused; the code is on screen either way.
      setCopied(false)
    }
  }

  return (
    <div style={{
      padding: '13px 15px', borderRadius: 11, background: 'var(--card-2)',
      border: '1px solid var(--stroke)', opacity: live ? 1 : 0.6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{share.label}</span>
        <span style={{
          fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase',
          padding: '2px 7px', borderRadius: 20,
          color: status.tone === 'good' ? 'var(--mint)' : status.tone === 'bad' ? 'var(--red)' : 'var(--amber)',
          border: '1px solid currentColor',
        }}>{status.label}</span>
        {share.hide_amounts && (
          <span style={{ fontSize: 10, color: 'var(--text-3)' }}>R multiples</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-3)' }}>
          {share.view_count} view{share.view_count === 1 ? '' : 's'}
          {share.last_viewed_at && ` · last ${new Date(share.last_viewed_at).toLocaleDateString()}`}
        </span>
      </div>

      <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 5 }}>
        {sectionLabels(share.sections).join(' · ') || 'Nothing enabled'}
        {share.expires_at && ` · expires ${new Date(share.expires_at).toLocaleDateString()}`}
      </div>

      {live && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
          <code className="mono" style={{
            flex: 1, minWidth: 200, fontSize: 11, padding: '7px 10px', borderRadius: 8,
            background: 'var(--hex-bg)', color: 'var(--text-2)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{url}</code>
          <button onClick={copy} style={ghost}>{copied ? 'Copied' : 'Copy'}</button>
          <button onClick={onRevoke} style={{ ...ghost, color: 'var(--red)', borderColor: 'var(--red)' }}>
            Revoke
          </button>
        </div>
      )}

      {!live && (
        <div style={{ marginTop: 10 }}>
          <button
            onClick={() => { if (confirming) onRemove(); else { setConfirming(true); setTimeout(() => setConfirming(false), 2600) } }}
            style={{ fontSize: 11, color: confirming ? 'var(--red)' : 'var(--text-3)' }}>
            {confirming ? 'Delete permanently?' : 'Delete'}
          </button>
          <span style={{ fontSize: 10.5, color: 'var(--text-3)', marginLeft: 10 }}>
            Kept so you can still see it existed and how often it was opened.
          </span>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-3)', display: 'block', marginBottom: 5 }}>
        {label}
      </span>
      {children}
    </label>
  )
}

const control = {
  background: 'var(--input-bg)', border: '1px solid var(--stroke)', color: 'var(--text)',
  borderRadius: 9, padding: '9px 11px', fontSize: 13, width: '100%',
}

const ghost = {
  padding: '7px 12px', borderRadius: 9, fontSize: 12,
  border: '1px solid var(--stroke)', color: 'var(--text-2)',
}
