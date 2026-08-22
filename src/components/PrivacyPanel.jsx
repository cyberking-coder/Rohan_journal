import { useState } from 'react'
import { motion } from 'framer-motion'
import { DELETIONS, confirms, summarise } from '../lib/privacy'
import { usePrivacy } from '../lib/usePrivacy'
import { useAuth } from '../lib/AuthContext'

/**
 * Data export and deletion — PRD §83.
 *
 * The wording throughout is deliberately blunt. The instinct when writing a
 * destructive dialog is to soften it so the product feels friendly; here the
 * alarm is the feature, and a user who deletes their journal because the
 * button was reassuring has been failed.
 */
export default function PrivacyPanel() {
  const { user } = useAuth()
  const { busy, error, result, exportAll, runDeletion, deleteAccount } = usePrivacy(user)
  const [open, setOpen] = useState(null)
  const [typed, setTyped] = useState('')

  const start = (key) => { setOpen(key); setTyped('') }
  const cancel = () => { setOpen(null); setTyped('') }

  const run = async (key) => {
    if (!confirms(typed, key)) return
    if (key === 'account') await deleteAccount()
    else await runDeletion(key)
    cancel()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 5 }}>Export everything</div>
        <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.65, marginBottom: 11, maxWidth: 560 }}>
          Downloads a single JSON file with every trade, journal entry, tag, broker
          account, backtest, challenge and preference held for your account. If anything
          could not be read, the file says so inside itself rather than leaving you to
          find out later.
        </p>
        <button className="btn-primary" onClick={exportAll} disabled={busy === 'export'}>
          {busy === 'export' ? 'Collecting…' : 'Download my data'}
        </button>

        {result?.kind === 'export' && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 8 }}>
              Downloaded. It contains:
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 7 }}>
              {summarise(result.sections).map((row) => (
                <div key={row.table} style={{
                  fontSize: 11.5, padding: '7px 10px', borderRadius: 8, background: 'var(--card-2)',
                  color: row.present ? 'var(--text-2)' : 'var(--text-3)',
                  display: 'flex', justifyContent: 'space-between', gap: 8,
                }}>
                  <span>{row.label}</span>
                  <span className="mono">{row.present ? row.count : '—'}</span>
                </div>
              ))}
            </div>
            {result.warnings?.length > 0 && (
              <div style={{
                marginTop: 10, padding: '10px 12px', borderRadius: 9, fontSize: 11.5, lineHeight: 1.6,
                background: 'rgba(232,177,58,0.09)', border: '1px solid rgba(232,177,58,0.26)',
                color: 'var(--amber, #e8b13a)',
              }}>
                {result.warnings.map((w, i) => <div key={i}>{w}</div>)}
              </div>
            )}
          </motion.div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 5 }}>Delete data</div>
        <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.65, marginBottom: 12, maxWidth: 560 }}>
          None of these can be undone, and support cannot recover anything afterwards.
          Export first if you are not certain.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {Object.entries(DELETIONS).map(([key, spec]) => (
            <Row
              key={key} id={key} spec={spec}
              open={open === key} busy={busy === key}
              typed={typed} setTyped={setTyped}
              onStart={() => start(key)} onCancel={cancel} onRun={() => run(key)}
            />
          ))}
        </div>
      </div>

      {error && (
        <div style={{
          padding: '11px 13px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.6,
          background: 'rgba(255,90,90,0.09)', border: '1px solid rgba(255,90,90,0.3)', color: 'var(--red)',
        }}>{error}</div>
      )}

      {result?.kind === 'delete' && !error && (
        <div style={{ fontSize: 12, color: 'var(--mint)' }}>
          Done — {result.cleared.length} item(s) cleared.
        </div>
      )}

      {/* Said plainly rather than hidden behind a successful-looking sign-out.
          A product that pretends to have deleted an account it cannot delete
          is making a promise it has not kept. */}
      <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6, maxWidth: 560 }}>
        Deleting your account removes every row and file belonging to you and signs you
        out. Removing the sign-in record itself needs server-side privileges the browser
        deliberately does not have — email support to have it erased, or it will be
        cleared on the next scheduled sweep.
      </p>
    </div>
  )
}

function Row({ id, spec, open, busy, typed, setTyped, onStart, onCancel, onRun }) {
  const terminal = !!spec.terminal
  const ready = confirms(typed, id)

  return (
    <div style={{
      padding: '12px 14px', borderRadius: 11,
      background: 'var(--card-2)',
      border: `1px solid ${terminal ? 'rgba(255,90,90,0.3)' : 'var(--stroke)'}`,
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: terminal ? 'var(--red)' : 'var(--text)' }}>
            {spec.label}
          </div>
          {/* The scope is spelled out before the button, not after. */}
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.6 }}>
            {spec.warning}
          </div>
        </div>
        {!open && (
          <button onClick={onStart}
            style={{
              padding: '7px 13px', borderRadius: 9, fontSize: 12, fontWeight: 600,
              border: '1px solid rgba(255,90,90,0.3)', color: 'var(--red)', background: 'transparent',
            }}>{terminal ? 'Delete account' : 'Delete'}</button>
        )}
      </div>

      {open && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
          style={{ marginTop: 12, overflow: 'hidden' }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 7 }}>
            Type <strong className="mono" style={{ color: 'var(--red)' }}>{spec.confirmWord}</strong> to confirm.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus
              placeholder={spec.confirmWord}
              style={{
                background: 'var(--input-bg)', border: '1px solid var(--stroke)', color: 'var(--text)',
                borderRadius: 9, padding: '8px 11px', fontSize: 12.5, flex: '1 1 200px', outline: 'none',
              }} />
            <button onClick={onCancel} style={{ fontSize: 12, color: 'var(--text-3)', padding: '8px 13px' }}>
              Cancel
            </button>
            <button
              onClick={onRun} disabled={!ready || busy}
              style={{
                padding: '8px 15px', borderRadius: 9, fontSize: 12, fontWeight: 600, border: 'none',
                background: ready ? 'var(--red)' : 'var(--card)',
                color: ready ? '#fff' : 'var(--text-3)',
                cursor: ready ? 'pointer' : 'not-allowed',
              }}>{busy ? 'Deleting…' : 'Confirm'}</button>
          </div>
        </motion.div>
      )}
    </div>
  )
}
