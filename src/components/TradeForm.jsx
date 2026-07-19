import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { StarRating } from './widgets'
import { uploadScreenshot } from '../lib/storage'
import { contractSizeFor, computePnl, ASSET_GROUPS, STRATEGIES } from '../lib/instruments'
import { parseRR, fmtRR } from '../lib/stats'

const SESSIONS = ['London', 'New York', 'Asia', 'Overlap']
const CUSTOM = '__custom__'

const field = {
  background: '#0e1413', border: '1px solid var(--stroke)', color: 'var(--text)',
  borderRadius: 10, padding: '11px 13px', fontSize: 14, width: '100%', outline: 'none',
}
const labelStyle = { fontSize: 11.5, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, display: 'block' }

function Labeled({ label, hint, children }) {
  return (
    <div>
      <label style={labelStyle}>{label}{hint && <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--mint)', marginLeft: 6, fontWeight: 500 }}>{hint}</span>}</label>
      {children}
    </div>
  )
}

export default function TradeForm({ open, onClose, onSubmit, userId }) {
  const [form, setForm] = useState(blank())
  const [rating, setRating] = useState(3)
  const [saving, setSaving] = useState(false)
  const [pnlTouched, setPnlTouched] = useState(false)
  const [csTouched, setCsTouched] = useState(false)
  const [rrTouched, setRrTouched] = useState(false)
  const [customSym, setCustomSym] = useState(false)
  const [autoCalc, setAutoCalc] = useState(false)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [err, setErr] = useState(null)

  function blank() {
    return {
      symbol: 'XAUUSD', side: 'Long', strategy: STRATEGIES[0], session: 'New York',
      entry: '', exit: '', sl: '', tp: '', qty: '0.10', pnl: '', fees: '2', rr: '',
      contractSize: '100',
      notes: '', traded_at: new Date().toISOString().slice(0, 16),
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  // Auto-detect contract size from the symbol (unless user overrode it).
  useEffect(() => {
    if (csTouched || !form.symbol) return
    const cs = contractSizeFor(form.symbol)
    setForm((f) => ({ ...f, contractSize: String(cs) }))
  }, [form.symbol, csTouched])

  // Auto-calculate R:R = reward ÷ risk from entry / stop-loss / take-profit.
  useEffect(() => {
    if (rrTouched) return
    const e = parseFloat(form.entry)
    const sl = parseFloat(form.sl)
    const tp = parseFloat(form.tp)
    if (![e, sl, tp].every(isFinite)) return
    const risk = Math.abs(e - sl)
    const reward = Math.abs(tp - e)
    if (!risk) return
    setForm((f) => ({ ...f, rr: fmtRR(reward / risk) }))
  }, [form.entry, form.sl, form.tp, rrTouched])

  // Auto-calculate P&L = price move × lots × contract size (unless overridden).
  useEffect(() => {
    if (pnlTouched) return
    const pnl = computePnl({
      entry: form.entry, exit: form.exit, lots: form.qty,
      side: form.side, contractSize: form.contractSize,
    })
    if (pnl === null) { setAutoCalc(false); return }
    setForm((f) => ({ ...f, pnl: String(pnl) }))
    setAutoCalc(true)
  }, [form.entry, form.exit, form.qty, form.side, form.contractSize, pnlTouched])

  function onPickFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.type.startsWith('image/')) { setErr('Please choose an image file.'); return }
    if (f.size > 6 * 1024 * 1024) { setErr('Image must be under 6 MB.'); return }
    setErr(null)
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  function removeFile() {
    setFile(null)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
  }

  function resetAll() {
    setForm(blank()); setRating(3); setPnlTouched(false); setCsTouched(false); setRrTouched(false); setAutoCalc(false)
    setCustomSym(false); removeFile(); setErr(null)
  }

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setErr(null)
    try {
      let screenshot_url = null
      if (file) screenshot_url = await uploadScreenshot(file, userId)

      const record = {
        symbol: form.symbol.toUpperCase() || 'N/A',
        side: form.side,
        strategy: form.strategy,
        session: form.session,
        entry: parseFloat(form.entry) || 0,
        exit: parseFloat(form.exit) || 0,
        qty: parseFloat(form.qty) || 0,
        pnl: parseFloat(form.pnl) || 0,
        fees: parseFloat(form.fees) || 0,
        rr: parseRR(form.rr),
        rating,
        notes: form.notes,
        screenshot_url,
        traded_at: new Date(form.traded_at).toISOString(),
      }
      const res = await onSubmit(record)
      if (res?.error) throw new Error(res.error.message || 'Could not save trade')
      resetAll()
      onClose()
    } catch (e2) {
      setErr(e2.message || 'Something went wrong')
    } finally {
      setSaving(false)
    }
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
            style={{ width: 'min(640px, 100%)', maxHeight: '92vh', overflowY: 'auto', padding: 26 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
              <div>
                <div className="eyebrow">New entry</div>
                <h2 style={{ fontFamily: 'var(--display)', fontSize: 22, marginTop: 4 }}>Log a Trade</h2>
              </div>
              <button type="button" onClick={onClose} style={{ fontSize: 22, color: 'var(--text-3)' }}>✕</button>
            </div>

            <div className="form-grid">
              <Labeled label="Asset">
                {customSym ? (
                  <div style={{ position: 'relative' }}>
                    <input style={field} value={form.symbol} onChange={set('symbol')} placeholder="e.g. USDINR" autoFocus required />
                    <button type="button" title="Back to list"
                      onClick={() => { setCustomSym(false); setForm((f) => ({ ...f, symbol: 'XAUUSD' })) }}
                      style={{ position: 'absolute', right: 8, top: 8, fontSize: 11, color: 'var(--mint)', background: 'rgba(47,212,138,0.1)', padding: '3px 7px', borderRadius: 6 }}>list</button>
                  </div>
                ) : (
                  <select style={field} value={form.symbol}
                    onChange={(e) => {
                      if (e.target.value === CUSTOM) { setCustomSym(true); setForm((f) => ({ ...f, symbol: '' })) }
                      else set('symbol')(e)
                    }}>
                    {ASSET_GROUPS.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.items.map((a) => <option key={a} value={a}>{a}</option>)}
                      </optgroup>
                    ))}
                    <option value={CUSTOM}>Custom…</option>
                  </select>
                )}
              </Labeled>
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
              <Labeled label="Lots" hint="e.g. 0.10"><input type="number" step="any" style={field} value={form.qty} onChange={set('qty')} placeholder="0.10" /></Labeled>

              <Labeled label="Entry"><input type="number" step="any" style={field} value={form.entry} onChange={set('entry')} placeholder="2000.00" /></Labeled>
              <Labeled label="Stop Loss"><input type="number" step="any" style={field} value={form.sl} onChange={set('sl')} placeholder="1997.00" /></Labeled>
              <Labeled label="Take Profit"><input type="number" step="any" style={field} value={form.tp} onChange={set('tp')} placeholder="2006.00" /></Labeled>

              <Labeled label="Exit" hint="actual close"><input type="number" step="any" style={field} value={form.exit} onChange={set('exit')} placeholder="2006.00" /></Labeled>
              <Labeled label="R : R" hint={rrTouched ? 'manual' : 'auto'}>
                <div style={{ position: 'relative' }}>
                  <input type="text" style={field} value={form.rr}
                    onChange={(e) => { setRrTouched(true); set('rr')(e) }}
                    placeholder="1:2" />
                  {rrTouched && (
                    <button type="button" title="Back to auto"
                      onClick={() => setRrTouched(false)}
                      style={{ position: 'absolute', right: 8, top: 8, fontSize: 11, color: 'var(--mint)', background: 'rgba(47,212,138,0.1)', padding: '3px 7px', borderRadius: 6 }}>auto</button>
                  )}
                </div>
              </Labeled>

              <Labeled label="Contract Size" hint={csTouched ? undefined : 'auto'}>
                <input type="number" step="any" style={field} value={form.contractSize}
                  onChange={(e) => { setCsTouched(true); set('contractSize')(e) }}
                  placeholder="100" />
              </Labeled>
              <Labeled label="Net P&L" hint={autoCalc && !pnlTouched ? 'auto' : undefined}>
                <div style={{ position: 'relative' }}>
                  <input
                    type="number" step="any"
                    style={{ ...field, color: parseFloat(form.pnl) < 0 ? 'var(--red)' : parseFloat(form.pnl) > 0 ? 'var(--mint)' : 'var(--text)', fontFamily: 'var(--mono)', fontWeight: 600 }}
                    value={form.pnl}
                    onChange={(e) => { setPnlTouched(true); set('pnl')(e) }}
                    placeholder="auto"
                    required
                  />
                  {pnlTouched && (
                    <button type="button" title="Back to auto"
                      onClick={() => setPnlTouched(false)}
                      style={{ position: 'absolute', right: 8, top: 8, fontSize: 11, color: 'var(--mint)', background: 'rgba(47,212,138,0.1)', padding: '3px 7px', borderRadius: 6 }}>
                      auto
                    </button>
                  )}
                </div>
              </Labeled>
              <Labeled label="Commission ($)"><input type="number" step="any" style={field} value={form.fees} onChange={set('fees')} /></Labeled>
            </div>

            {/* Live calculation breakdown */}
            <PnlBreakdown form={form} />

            <div style={{ marginTop: 14 }}>
              <label style={labelStyle}>Rating</label>
              <div style={{ paddingTop: 4 }}><StarRating value={rating} onChange={setRating} size={24} /></div>
            </div>

            {/* Screenshot */}
            <div style={{ marginTop: 16 }}>
              <label style={labelStyle}>Trade Screenshot</label>
              {preview ? (
                <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--stroke)' }}>
                  <img src={preview} alt="trade" style={{ width: '100%', maxHeight: 240, objectFit: 'contain', background: '#0b100f', display: 'block' }} />
                  <button type="button" onClick={removeFile}
                    style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(4,7,6,0.75)', color: '#fff', borderRadius: 8, padding: '5px 9px', fontSize: 12 }}>
                    Remove
                  </button>
                </div>
              ) : (
                <label style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                  border: '1px dashed var(--stroke)', borderRadius: 12, padding: '22px', cursor: 'pointer',
                  color: 'var(--text-3)', fontSize: 13, background: '#0e1413',
                }}>
                  <span style={{ fontSize: 22 }}>🖼️</span>
                  <span>Click to upload a chart screenshot (PNG/JPG, ≤ 6 MB)</span>
                  <input type="file" accept="image/*" onChange={onPickFile} style={{ display: 'none' }} />
                </label>
              )}
            </div>

            <div style={{ marginTop: 14 }}>
              <Labeled label="Notes">
                <textarea style={{ ...field, minHeight: 70, resize: 'vertical' }} value={form.notes} onChange={set('notes')} placeholder="Setup, emotions, execution grade..." />
              </Labeled>
            </div>

            {err && <div style={{ marginTop: 14, color: 'var(--red)', fontSize: 13, background: 'rgba(255,107,107,0.08)', padding: '10px 12px', borderRadius: 10 }}>{err}</div>}

            <div style={{ display: 'flex', gap: 12, marginTop: 20, justifyContent: 'flex-end' }}>
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

function PnlBreakdown({ form }) {
  const e = parseFloat(form.entry)
  const x = parseFloat(form.exit)
  const lots = parseFloat(form.qty)
  const cs = parseFloat(form.contractSize) || 1
  if (![e, x, lots].every(isFinite) || !lots) return null

  const move = form.side === 'Long' ? x - e : e - x
  const pnl = Math.round(move * lots * cs * 100) / 100
  const perDollar = Math.round(lots * cs * 100) / 100
  const pos = pnl >= 0

  const fmt = (n) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <div style={{
      marginTop: 12, padding: '11px 14px', borderRadius: 11,
      border: '1px solid var(--stroke)', background: '#0e1413',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
      fontSize: 13,
    }}>
      <span style={{ color: 'var(--text-2)', fontFamily: 'var(--mono)' }}>
        {lots} lot × <span style={{ color: move >= 0 ? 'var(--mint)' : 'var(--red)' }}>{move >= 0 ? '+' : ''}{move.toFixed(2)}</span> move × {cs}
      </span>
      <span style={{ color: 'var(--text-3)', fontSize: 11.5 }}>
        every $1.00 move = {fmt(perDollar)}
      </span>
      <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 15, color: pos ? 'var(--mint)' : 'var(--red)' }}>
        = {fmt(pnl)}
      </span>
    </div>
  )
}
