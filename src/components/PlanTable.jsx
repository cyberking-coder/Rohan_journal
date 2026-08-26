import { motion } from 'framer-motion'
import {
  DEFAULT_PLAN, LIMIT_LABELS, PLANS, PLAN_ORDER, allows, describeLimit,
  downgradeImpact, nounFor, rank,
} from '../lib/plans'
import { describeStatus } from '../lib/billing'

/**
 * The plan ladder — PRD §84.
 *
 * No payment is taken. That is stated once, plainly, at the top rather than
 * discovered by clicking a button that does nothing: a fake checkout is worse
 * than an honest "not yet", because a user who reaches for their card and
 * finds a dead end stops trusting the rest of the product.
 */
export default function PlanTable({
  current = DEFAULT_PLAN, usage = {}, subscription = null,
  onCheckout, onPortal, busy = null, configured = false, error = null,
}) {
  const status = describeStatus(subscription)

  return (
    <>
      {/* The state of the subscription comes first. Someone opening this page
          is usually here to answer "am I paying, and until when" — the ladder
          below is for the minority who are changing something. */}
      <div style={{
        padding: '12px 14px', borderRadius: 11, marginBottom: 16,
        background: toneBg(status.tone), border: `1px solid ${toneLine(status.tone)}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>
            {PLANS[current]?.label || 'Free'}
          </span>
          <span style={{ fontSize: 12, color: toneText(status.tone) }}>{status.text}</span>
        </div>
        {subscription?.stripe_customer_id && (
          <button onClick={onPortal} disabled={busy === 'portal'}
            style={{
              marginTop: 10, padding: '7px 13px', borderRadius: 9, fontSize: 12, fontWeight: 600,
              border: '1px solid var(--stroke)', color: 'var(--text-2)', background: 'transparent',
            }}>
            {busy === 'portal' ? 'Opening…' : 'Manage billing'}
          </button>
        )}
      </div>

      {!configured && (
        <div style={{
          padding: '11px 13px', borderRadius: 10, marginBottom: 16, fontSize: 12, lineHeight: 1.65,
          background: 'var(--card-2)', border: '1px solid var(--stroke)', color: 'var(--text-3)',
        }}>
          <strong style={{ color: 'var(--text-2)' }}>Payments aren’t switched on yet.</strong>{' '}
          The tiers below are real and their limits are enforced, but this deployment has no
          Stripe keys set — see <code>docs/BILLING.md</code>. Subscribing will fail until it does,
          which is better than a checkout button that silently goes nowhere.
        </div>
      )}

      {error && (
        <div style={{
          padding: '11px 13px', borderRadius: 10, marginBottom: 16, fontSize: 12.5,
          background: 'rgba(255,90,90,0.09)', border: '1px solid rgba(255,90,90,0.3)', color: 'var(--red)',
        }}>{error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 13 }}>
        {PLAN_ORDER.map((id, i) => {
          const plan = PLANS[id]
          const on = id === current
          return (
            <motion.div key={id}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              style={{
                padding: 17, borderRadius: 13,
                background: on ? 'rgba(47,212,138,0.06)' : 'var(--card-2)',
                border: `1px solid ${on ? 'var(--mint)' : 'var(--stroke)'}`,
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{plan.label}</span>
                {on && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--mint)' }}>CURRENT</span>}
              </div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 700, marginTop: 7 }}>
                {plan.price === 0 ? 'Free' : `$${plan.price}`}
                {plan.price > 0 && <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500 }}>/mo</span>}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 5, lineHeight: 1.5 }}>{plan.blurb}</div>

              <ul style={{ listStyle: 'none', margin: '13px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {plan.features.map((f) => (
                  <li key={f} style={{ fontSize: 11.5, color: 'var(--text-2)', display: 'flex', gap: 7 }}>
                    <span style={{ color: 'var(--mint)' }}>·</span>{f}
                  </li>
                ))}
              </ul>

              {/* Downgrades deliberately have no button here. Changing or
                  ending a subscription happens in Stripe's portal, where the
                  proration and the cancellation terms are handled properly —
                  a "downgrade" button of our own would have to reimplement
                  all of it, and get it wrong. */}
              {!on && plan.price > 0 && rank(id) > rank(current) && (
                <button onClick={() => onCheckout?.(id)} disabled={busy === id}
                  style={{
                    marginTop: 14, width: '100%', padding: '9px 0', borderRadius: 9,
                    fontSize: 12.5, fontWeight: 600, border: 'none',
                    background: 'linear-gradient(120deg, #3ee39a, #23b978)', color: '#04140d',
                    cursor: busy ? 'wait' : 'pointer',
                  }}>
                  {busy === id ? 'Opening Stripe…' : `Upgrade to ${plan.label}`}
                </button>
              )}
              {!on && rank(id) < rank(current) && (
                <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                  To move down a plan, use Manage billing above.
                </div>
              )}
            </motion.div>
          )
        })}
      </div>

      <div style={{ marginTop: 22 }}>
        <div style={{
          fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
          color: 'var(--text-3)', marginBottom: 10,
        }}>Where you stand</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.keys(LIMIT_LABELS).map((key) => {
            const state = allows(current, key, usage[key])
            const limit = describeLimit(state.limit)
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'baseline', gap: 9, fontSize: 12 }}>
                <span style={{ color: 'var(--text-2)', minWidth: 160, textTransform: 'capitalize' }}>
                  {nounFor(key, 2)}
                </span>
                <span className="mono" style={{ color: state.over ? 'var(--amber, #e8b13a)' : 'var(--text-3)' }}>
                  {state.have} / {limit}
                </span>
                {state.over && (
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    over the limit — kept, but no new ones
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Shown before anyone cancels, not after. A user who downgrades and only
          then finds four of five accounts have stopped syncing has been
          ambushed, even though nothing was deleted. */}
      {current !== DEFAULT_PLAN && (
        <div style={{ marginTop: 20 }}>
          <div style={{
            fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: 'var(--text-3)', marginBottom: 9,
          }}>If you cancelled today</div>
          {downgradeImpact(current, DEFAULT_PLAN, usage).map((e) => (
            <div key={e.key} style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.65, marginBottom: 4 }}>
              <span style={{ color: 'var(--text-2)', textTransform: 'capitalize' }}>{e.label}</span>
              {' '}{e.before} → {e.after}.{e.note ? ` ${e.note}` : ''}
            </div>
          ))}
          <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
            Nothing is ever deleted by a downgrade. You keep what you have and stop being
            able to add more.
          </p>
        </div>
      )}
    </>
  )
}

function toneBg(tone) {
  return tone === 'good' ? 'rgba(62,227,154,0.07)'
    : tone === 'warn' ? 'rgba(232,177,58,0.08)'
      : tone === 'bad' ? 'rgba(255,90,90,0.08)' : 'var(--card-2)'
}
function toneLine(tone) {
  return tone === 'good' ? 'rgba(62,227,154,0.26)'
    : tone === 'warn' ? 'rgba(232,177,58,0.26)'
      : tone === 'bad' ? 'rgba(255,90,90,0.28)' : 'var(--stroke)'
}
function toneText(tone) {
  return tone === 'good' ? 'var(--mint)'
    : tone === 'warn' ? 'var(--amber, #e8b13a)'
      : tone === 'bad' ? 'var(--red)' : 'var(--text-3)'
}
