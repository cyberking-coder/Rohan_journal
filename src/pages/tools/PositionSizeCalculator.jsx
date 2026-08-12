import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import ToolPageShell from '../../components/ToolPageShell'
import {
  DEFAULT_INSTRUMENT, INSTRUMENT_GROUPS, calculatePositionSize,
  fmtLots, fmtPipSize, getInstrument,
} from '../../lib/pips'
import { fmtMoney } from '../../lib/stats'

const RISK_PRESETS = [0.5, 1, 2, 3, 5]

// The slider's labelled zones. A trader risking 4% per trade should see that
// called what it is.
function riskZone(pct) {
  if (pct <= 1) return { label: 'Conservative', tone: 'var(--mint)' }
  if (pct <= 2) return { label: 'Moderate', tone: 'var(--amber)' }
  return { label: 'Aggressive', tone: 'var(--red)' }
}

export default function PositionSizeCalculator({ onBack }) {
  const [balance, setBalance] = useState('')
  const [risk, setRisk] = useState(1)
  const [stopLoss, setStopLoss] = useState('')
  const [symbol, setSymbol] = useState(DEFAULT_INSTRUMENT)
  const [useCustomPip, setUseCustomPip] = useState(false)
  const [customPip, setCustomPip] = useState('')
  const [result, setResult] = useState(null)

  const instrument = getInstrument(symbol)
  const effectivePipValue = useCustomPip ? Number(customPip) : instrument?.pipValue
  const zone = riskZone(risk)

  // Live preview of the risk amount as the slider moves, before calculating.
  const riskAmount = useMemo(() => {
    const b = Number(balance)
    return Number.isFinite(b) && b > 0 ? b * (risk / 100) : null
  }, [balance, risk])

  const canCalculate = calculatePositionSize({
    balance, riskPercent: risk, stopLossPips: stopLoss, pipValue: effectivePipValue,
  }) !== null

  const calculate = () => {
    setResult(calculatePositionSize({
      balance, riskPercent: risk, stopLossPips: stopLoss, pipValue: effectivePipValue,
    }))
  }

  const reset = () => {
    setBalance(''); setRisk(1); setStopLoss(''); setSymbol(DEFAULT_INSTRUMENT)
    setUseCustomPip(false); setCustomPip(''); setResult(null)
  }

  return (
    <ToolPageShell
      icon="⚖" title="Position Size Calculator" onBack={onBack}
      subtitle="Size every trade off your risk, not your gut."
    >
      <div className="tool-split">
        {/* ── Inputs ─────────────────────────────────────────────────── */}
        <section className="card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Field label="Account Balance">
            <div style={{ position: 'relative' }}>
              <span style={{
                position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)',
                color: 'var(--text-3)', fontSize: 14, pointerEvents: 'none',
              }}>$</span>
              <input
                type="number" inputMode="decimal" min="0" value={balance}
                onChange={(e) => setBalance(e.target.value)} placeholder="10,000"
                style={{ ...inputStyle, paddingLeft: 28 }}
              />
            </div>
          </Field>

          <Field
            label="Risk Percentage"
            hint={riskAmount !== null ? `${fmtMoney(riskAmount, 2)} at risk` : null}
          >
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              {RISK_PRESETS.map((p) => (
                <button key={p} onClick={() => setRisk(p)}
                  style={{
                    padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                    border: `1px solid ${risk === p ? 'var(--mint)' : 'var(--stroke)'}`,
                    background: risk === p ? 'rgba(47,212,138,0.12)' : 'var(--card-2)',
                    color: risk === p ? 'var(--mint)' : 'var(--text-2)',
                  }}>{p}%</button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input
                type="range" min="0.5" max="5" step="0.1" value={risk}
                onChange={(e) => setRisk(Number(e.target.value))}
                style={{ flex: 1, accentColor: zone.tone }}
              />
              <span className="mono" style={{ fontSize: 14, fontWeight: 600, minWidth: 46, textAlign: 'right' }}>
                {risk.toFixed(1)}%
              </span>
            </div>
            <div style={{ marginTop: 7, fontSize: 11.5, color: zone.tone, fontWeight: 600 }}>{zone.label}</div>
          </Field>

          <Field label="Stop Loss Distance">
            <div style={{ position: 'relative' }}>
              <input
                type="number" inputMode="decimal" min="0" value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)} placeholder="20"
                style={{ ...inputStyle, paddingRight: 46 }}
              />
              <span style={{
                position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)',
                color: 'var(--text-3)', fontSize: 12.5, pointerEvents: 'none',
              }}>pips</span>
            </div>
          </Field>

          <Field label="Trading Instrument">
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} style={inputStyle}>
              {INSTRUMENT_GROUPS.map((g) => (
                <optgroup key={g.category} label={g.label}>
                  {g.items.map((i) => (
                    <option key={i.symbol} value={i.symbol}>{i.symbol} — {i.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>

            {instrument && (
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 11.5, color: 'var(--text-3)' }}>
                <span>Pip size <span className="mono" style={{ color: 'var(--text-2)' }}>{fmtPipSize(instrument.pipSize)}</span></span>
                <span>Pip value <span className="mono" style={{ color: 'var(--text-2)' }}>{fmtMoney(instrument.pipValue, 2)}/lot</span></span>
              </div>
            )}

            {/* Rate-dependent pairs are honest about being approximate rather
                than presenting a stale number as fact. */}
            {instrument?.approx && !useCustomPip && (
              <div style={{
                marginTop: 10, padding: '8px 11px', borderRadius: 9, fontSize: 11.5, lineHeight: 1.5,
                background: 'rgba(255,207,107,0.09)', border: '1px solid rgba(255,207,107,0.28)',
                color: 'var(--amber)',
              }}>
                Approximate — {instrument.approx}. Tick “custom pip value” below for your broker’s exact figure.
              </div>
            )}
          </Field>

          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, cursor: 'pointer', color: 'var(--text-2)' }}>
              <input type="checkbox" checked={useCustomPip}
                onChange={(e) => {
                  setUseCustomPip(e.target.checked)
                  // Seed with the instrument's value so it's an edit, not a blank.
                  if (e.target.checked && !customPip) setCustomPip(String(instrument?.pipValue ?? ''))
                }}
                style={{ accentColor: 'var(--mint)', width: 15, height: 15 }} />
              Use custom pip value
            </label>
            <AnimatePresence>
              {useCustomPip && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}
                  style={{ overflow: 'hidden' }}
                >
                  <div style={{ position: 'relative', marginTop: 11 }}>
                    <span style={{
                      position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)',
                      color: 'var(--text-3)', fontSize: 14, pointerEvents: 'none',
                    }}>$</span>
                    <input
                      type="number" inputMode="decimal" min="0" step="0.01" value={customPip}
                      onChange={(e) => setCustomPip(e.target.value)} placeholder="10.00"
                      style={{ ...inputStyle, paddingLeft: 28 }}
                    />
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-3)' }}>
                    Pip value per 1.0 standard lot, in USD.
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
            <motion.button whileTap={{ scale: canCalculate ? 0.97 : 1 }}
              onClick={calculate} disabled={!canCalculate}
              style={{
                flex: 1, padding: '12px', borderRadius: 12, fontWeight: 600, fontSize: 14,
                background: canCalculate ? 'linear-gradient(120deg, #3ee39a, #23b978)' : 'var(--card-2)',
                color: canCalculate ? '#04140d' : 'var(--text-3)',
                border: canCalculate ? 'none' : '1px solid var(--stroke)',
                cursor: canCalculate ? 'pointer' : 'not-allowed',
                boxShadow: canCalculate ? '0 10px 26px -12px rgba(47,212,138,0.7)' : 'none',
              }}>Calculate Position Size</motion.button>
            <button onClick={reset}
              style={{
                padding: '12px 18px', borderRadius: 12, fontSize: 13.5, color: 'var(--text-2)',
                border: '1px solid var(--stroke)', background: 'var(--card-2)',
              }}>Reset</button>
          </div>
        </section>

        {/* ── Output ─────────────────────────────────────────────────── */}
        <section className="card" style={{ padding: 22, display: 'flex', flexDirection: 'column' }}>
          {result ? <Result result={result} risk={risk} symbol={symbol} stopLoss={stopLoss} />
                  : <EmptyState />}
        </section>
      </div>
    </ToolPageShell>
  )
}

function Result({ result, risk, symbol, stopLoss }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <div style={{
        padding: '26px 20px', borderRadius: 14, textAlign: 'center',
        background: 'linear-gradient(150deg, rgba(47,212,138,0.14), rgba(47,212,138,0.03))',
        border: '1px solid rgba(47,212,138,0.28)',
      }}>
        <div className="eyebrow" style={{ fontSize: 10 }}>Recommended position size</div>
        <div className="mono" style={{
          fontSize: 48, fontWeight: 700, lineHeight: 1.1, marginTop: 8, color: 'var(--mint)',
        }}>{fmtLots(result.standardLots)}</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2 }}>Standard Lots</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 10 }}>
          Based on {risk}% risk ({fmtMoney(result.riskAmount, 2)}) · {stopLoss} pip stop on {symbol}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
        <MiniCard label="Mini Lots" value={fmtLots(result.miniLots)} sub="10,000 units each" />
        <MiniCard label="Micro Lots" value={fmtLots(result.microLots)} sub="1,000 units each" />
        <MiniCard label="Risk Amount" value={fmtMoney(result.riskAmount, 2)} sub={`${risk}% of balance`} />
        <MiniCard label="Loss at Stop" value={fmtMoney(result.lossAtStop, 2)} sub="If your stop is hit" />
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6 }}>
        Total exposure ≈ {Math.round(result.units).toLocaleString()} units. Round down to your
        broker’s nearest step — sizing up is how a planned loss becomes an unplanned one.
      </div>
    </motion.div>
  )
}

function MiniCard({ label, value, sub }) {
  return (
    <div style={{
      padding: '14px 15px', borderRadius: 12,
      background: 'var(--card-2)', border: '1px solid var(--stroke)',
    }}>
      <div className="eyebrow" style={{ fontSize: 9.5 }}>{label}</div>
      <div className="mono" style={{ fontSize: 19, fontWeight: 600, marginTop: 6 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 3 }}>{sub}</div>
    </div>
  )
}

function EmptyState() {
  const tips = [
    'Most professionals risk 1–2% per trade.',
    'Always define your stop loss before entering.',
    'Position sizing is what keeps you in the game.',
  ]
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', textAlign: 'center', gap: 14, padding: '40px 12px',
    }}>
      <div style={{
        width: 52, height: 52, borderRadius: 16, fontSize: 23,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--card-2)', border: '1px solid var(--stroke)', color: 'var(--text-3)',
      }}>⚖</div>
      <div>
        <h3 style={{ fontFamily: 'var(--display)', fontSize: 16, fontWeight: 600 }}>Enter your parameters</h3>
        <p style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 5, maxWidth: 260, lineHeight: 1.6 }}>
          Fill in your balance, risk and stop distance to get a lot size.
        </p>
      </div>
      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        {tips.map((t) => (
          <li key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--text-2)', textAlign: 'left' }}>
            <span style={{ color: 'var(--mint)', flexShrink: 0 }}>✓</span>{t}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 10 }}>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)' }}>{label}</label>
        {hint && <span className="mono" style={{ fontSize: 11.5, color: 'var(--mint)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '11px 13px', borderRadius: 10, fontSize: 14,
  background: 'var(--input-bg)', border: '1px solid var(--stroke)',
  color: 'var(--text)', outline: 'none',
}
