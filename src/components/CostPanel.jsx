import Money from './Money'
import { COST_PRESETS, normaliseCosts } from '../lib/execution'

/**
 * The execution-cost controls for the backtester.
 *
 * Placed next to the order ticket rather than buried in settings, because the
 * costs are part of the experiment: changing the preset and watching a
 * profitable strategy stop being profitable is the single most useful thing
 * this page can show a trader.
 */
export function CostControls({ costs, onChange }) {
  const c = normaliseCosts(costs)
  const custom = (field) => (e) => onChange({ ...c, preset: 'custom', [field]: e.target.value })

  return (
    <div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
        {Object.entries(COST_PRESETS).map(([key, p]) => {
          const on = c.preset === key
          return (
            <button key={key} onClick={() => onChange({ ...COST_PRESETS[key], preset: key })} title={p.hint}
              style={{
                padding: '5px 11px', borderRadius: 20, fontSize: 11.5, fontWeight: 600,
                border: `1px solid ${on ? 'var(--mint)' : 'var(--stroke)'}`,
                color: on ? 'var(--mint)' : 'var(--text-3)',
                background: on ? 'rgba(47,212,138,0.09)' : 'transparent',
              }}>{p.label}</button>
          )
        })}
        {c.preset === 'custom' && (
          <span style={{ fontSize: 11, color: 'var(--text-3)', alignSelf: 'center' }}>custom</span>
        )}
      </div>

      {COST_PRESETS[c.preset]?.hint && (
        <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.55, marginBottom: 10 }}>
          {COST_PRESETS[c.preset].hint}
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))', gap: 9 }}>
        <Field label="Spread (pips)" value={c.spreadPips} onChange={custom('spreadPips')} />
        <Field label="Commission $/lot" value={c.commissionPerLot} onChange={custom('commissionPerLot')} />
        <Field label="Slippage (pips)" value={c.slippagePips} onChange={custom('slippagePips')} />
        <Field label="Swap $/lot long" value={c.swapLongPerLot} onChange={custom('swapLongPerLot')} />
        <Field label="Swap $/lot short" value={c.swapShortPerLot} onChange={custom('swapShortPerLot')} />
      </div>

      <p style={{ fontSize: 10.5, color: 'var(--text-3)', lineHeight: 1.6, marginTop: 11 }}>
        Presets are plausible retail figures, not quotes from your broker — put your own
        in if you know them. Spread is treated as fixed; live it widens into news and at
        the open, which is exactly when stops get hit, so these results are still the
        optimistic side of what you would have paid.
      </p>
    </div>
  )
}

function Field({ label, value, onChange }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 9.5, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 5 }}>
        {label}
      </div>
      <input type="number" step="any" value={value} onChange={onChange}
        style={{
          background: 'var(--input-bg)', border: '1px solid var(--stroke)', color: 'var(--text)',
          borderRadius: 8, padding: '7px 9px', fontSize: 12.5, width: '100%', outline: 'none',
        }} />
    </label>
  )
}

/**
 * Where the money went.
 *
 * "Your backtest made $4,000 instead of $6,200" is not an actionable thing to
 * be told. "$1,400 of that was spread and $800 was commission" tells the
 * trader whether to trade less often or find a cheaper broker, which is the
 * whole reason to model costs rather than merely subtract them.
 */
export function CostBreakdown({ summary }) {
  if (!summary || !summary.trades) return null
  const { gross, net, spreadCost, slippageCost, commission, swap, costShare, flipped } = summary

  const rows = [
    ['Gross', gross, null],
    ['Spread', -spreadCost, 'paid once per round trip'],
    ['Slippage', -slippageCost, 'on entries and stop fills'],
    ['Commission', -commission, null],
    ['Swap', swap, swap >= 0 ? 'credited overnight' : 'charged overnight'],
  ].filter(([, v], i) => i === 0 || Math.abs(v) > 1e-9)

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{
        fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
        color: 'var(--text-3)', marginBottom: 10,
      }}>Where the money went</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(([label, value, hint]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 12.5 }}>
            <span style={{ color: 'var(--text-2)' }}>{label}</span>
            {hint && <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{hint}</span>}
            <span className="mono" style={{ marginLeft: 'auto' }}>
              <Money value={value} colored />
            </span>
          </div>
        ))}
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 13,
          borderTop: '1px solid var(--stroke)', paddingTop: 8, marginTop: 2, fontWeight: 600,
        }}>
          <span>Net</span>
          <span className="mono" style={{ marginLeft: 'auto' }}><Money value={net} colored /></span>
        </div>
      </div>

      {/* The line that changes minds. A strategy whose gross edge is real but
          smaller than its costs looks fine in every other panel on the page. */}
      {flipped && (
        <div style={{
          marginTop: 12, padding: '11px 13px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.6,
          background: 'rgba(255,90,90,0.09)', border: '1px solid rgba(255,90,90,0.3)', color: 'var(--red)',
        }}>
          <strong>Costs turned this from a winner into a loser.</strong> The edge is real
          but smaller than what it costs to trade it — fewer, larger trades or a cheaper
          account would matter more here than a better entry.
        </div>
      )}

      {!flipped && costShare !== null && (
        <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 11, lineHeight: 1.6 }}>
          Costs took {costShare.toFixed(0)}% of the gross profit.
          {costShare > 50 && ' More than half — this strategy is trading too often for what it makes per trade.'}
        </p>
      )}
    </div>
  )
}
