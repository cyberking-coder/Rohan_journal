import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { StarRating } from './widgets'

const SESSIONS = ['London', 'New York', 'Asia', 'Overlap']
const STRATEGIES = ['Breakout', 'FBD', 'Gapper', 'Reversal', 'Trend Pullback']

const field = {
  background: '#0e1413', border: '1px solid var(--stroke)', color: 'var(--text)',
  borderRadius: 10, padding: '11px 13px', fontSize: 14, width: '100%', outline: 'none',
}
const labelStyle = { fontSize: 11.5, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, display: 'block' }

function Labeled({ label, children }) {
  return <div><label style={labelStyle}>{label}</label>{children}</div>
}

export default function TradeForm({ open, onClose, onSubmit }) {
  const [form, setForm] = useState(blank())
  const [rating, setRating] = useState(3)
  const [saving, setSaving] = useState(false)

  function blank() {
    return {
      symbol: '', side: 'Long', strategy: 'Breakout', session: 'New York',
      entry: '', exit: '', qty: '1', pnl: '', fees: '2', rr: '',
      notes: '', traded_at: new Date().toISOString().slice(0, 16),
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    const record = {
      symbol: form.symbol.toUpperCase() || 'N/A',
      side: form.side,
      strategy: form.strategy,
      session: form.session,
      entry: parseFloat(form.entry) || 0,
      exit: parseFloat(form.exit) || 0,
      qty: parseInt(form.qty) || 1,
      pnl: parseFloat(form.pnl) || 0,
      fees: parseFloat(form.fees) || 0,
      rr: parseFloat(form.rr) || 0,
      rating,
      notes: form.notes,
      traded_at: new Date(form.traded_at).toISOString(),
    }
    await onSubmit(record)
    setSaving(false)
    setForm(blank())
    setRating(3)
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            background: 'rgba(4,7,6,0.72)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <motion.form
            onClick={(e) => e.stopPropagation()}
            onSubmit={submit}
            initial={{ opacity: 0, y: 30, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ ease: [0.22, 1, 0.36, 1], duration: 0.35 }}
            className="card"
            style={{ width: 'min(620px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: 26 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
              <div>
                <div className="eyebrow">New entry</div>
                <h2 style={{ fontFamily: 'var(--display)', fontSize: 22, marginTop: 4 }}>Log a Trade</h2>
              </div>
              <button type="button" onClick={onClose} style={{ fontSize: 22, color: 'var(--text-3)' }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
              <Labeled label="Symbol"><input style={field} value={form.symbol} onChange={set('symbol')} placeholder="ES / EURUSD" required /></Labeled>
              <Labeled label="Side">
                <select style={field} value={form.side} onChange={set('side')}>
                  <option>Long</option><option>Short</option>
                </select>
              </Labeled>
              <Labeled label="Date / Time"><input type="datetime-local" style={field} value={form.traded_at} onChange={set('traded_at')} /></Labeled>

              <Labeled label="Strategy">
                <select style={field} value={form.strategy} onChange={set('strategy')}>
                  {STRATEGIES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </Labeled>
              <Labeled label="Session">
                <select style={field} value={form.session} onChange={set('session')}>
                  {SESSIONS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </Labeled>
              <Labeled label="Quantity"><input type="number" step="1" style={field} value={form.qty} onChange={set('qty')} /></Labeled>

              <Labeled label="Entry"><input type="number" step="any" style={field} value={form.entry} onChange={set('entry')} /></Labeled>
              <Labeled label="Exit"><input type="number" step="any" style={field} value={form.exit} onChange={set('exit')} /></Labeled>
              <Labeled label="R : R"><input type="number" step="any" style={field} value={form.rr} onChange={set('rr')} placeholder="2.1" /></Labeled>

              <Labeled label="Net P&L ($)"><input type="number" step="any" style={field} value={form.pnl} onChange={set('pnl')} placeholder="250 / -80" required /></Labeled>
              <Labeled label="Fees ($)"><input type="number" step="any" style={field} value={form.fees} onChange={set('fees')} /></Labeled>
              <div>
                <label style={labelStyle}>Rating</label>
                <div style={{ paddingTop: 8 }}><StarRating value={rating} onChange={setRating} size={22} /></div>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <Labeled label="Notes">
                <textarea style={{ ...field, minHeight: 74, resize: 'vertical' }} value={form.notes} onChange={set('notes')} placeholder="Setup, emotions, execution grade..." />
              </Labeled>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 22, justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} style={{ padding: '11px 20px', borderRadius: 11, border: '1px solid var(--stroke)', color: 'var(--text-2)' }}>Cancel</button>
              <motion.button
                whileTap={{ scale: 0.96 }}
                type="submit" disabled={saving}
                style={{
                  padding: '11px 24px', borderRadius: 11, fontWeight: 600,
                  background: 'linear-gradient(120deg, #3ee39a, #23b978)', color: '#04140d',
                  opacity: saving ? 0.7 : 1,
                }}
              >{saving ? 'Saving…' : 'Save Trade'}</motion.button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
