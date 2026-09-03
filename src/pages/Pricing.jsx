import { useState } from 'react'
import { motion } from 'framer-motion'
import { PageHeader } from '../components/common'
import { PLANS, priceFor } from '../lib/plans'
import { startCheckout, useSubscription } from '../lib/billing'

// The public pricing page. Layout mirrors the reference: a small "PRICING"
// pill, big heading, Yearly/Monthly toggle, then three cards with the
// middle "Pro" card raised as the most popular option.
//
// Prices come from src/lib/plans.js so a change here doesn't drift from any
// future gating logic. Checkout is not wired yet — the CTA calls an onSelect
// prop; the parent can route it to Stripe once billing is set up.

export default function Pricing() {
  const [billing, setBilling] = useState('yearly')
  const [pendingPlan, setPendingPlan] = useState(null)
  const [error, setError] = useState(null)
  const { sub } = useSubscription()
  const currentPlan = sub?.plan ?? 'free'

  const onSelect = async (planId) => {
    if (planId === 'free' || planId === currentPlan) return
    setError(null); setPendingPlan(planId)
    const { error } = await startCheckout({ plan: planId, billing })
    if (error) { setError(error); setPendingPlan(null) }
    // On success the browser is already redirecting to Stripe.
  }

  return (
    <div>
      <PageHeader eyebrow="PRICING" title="Plans for Every Trader">
        Start free, upgrade the moment your trading needs it.
      </PageHeader>

      <div style={{ display: 'flex', justifyContent: 'center', margin: '18px 0 34px' }}>
        <BillingToggle value={billing} onChange={setBilling} />
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 18,
        maxWidth: 1120,
        margin: '0 auto',
        alignItems: 'stretch',
      }}>
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            billing={billing}
            isCurrent={currentPlan === plan.id}
            isPending={pendingPlan === plan.id}
            onSelect={() => onSelect(plan.id)}
          />
        ))}
      </div>

      {error && (
        <div style={{
          maxWidth: 640, margin: '18px auto 0', padding: '10px 14px',
          borderRadius: 10, fontSize: 13, textAlign: 'center',
          background: 'rgba(255,107,107,0.09)', border: '1px solid rgba(255,107,107,0.3)', color: 'var(--red)',
        }}>{error}</div>
      )}

      <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 12.5, marginTop: 26 }}>
        All prices in USD. Cancel or change plan anytime. Cloud sync counts one broker account per connection.
      </div>
    </div>
  )
}

/* ── Billing toggle ─────────────────────────────────────────────────────── */

function BillingToggle({ value, onChange }) {
  return (
    <div style={{
      display: 'inline-flex', padding: 4, borderRadius: 999,
      background: 'var(--surface-2)', border: '1px solid var(--stroke)', position: 'relative',
    }}>
      <ToggleButton
        active={value === 'yearly'} onClick={() => onChange('yearly')}
      >
        Yearly
        <span style={{
          marginLeft: 8, padding: '2px 7px', borderRadius: 999, fontSize: 11,
          background: 'rgba(75, 209, 130, 0.18)', color: 'var(--mint)', fontWeight: 600,
        }}>Save 17%</span>
      </ToggleButton>
      <ToggleButton active={value === 'monthly'} onClick={() => onChange('monthly')}>
        Monthly
      </ToggleButton>
    </div>
  )
}

function ToggleButton({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '9px 18px', borderRadius: 999, border: 'none', cursor: 'pointer',
      background: active ? 'var(--surface)' : 'transparent',
      color: active ? 'var(--text-1)' : 'var(--text-3)',
      fontWeight: 600, fontSize: 13.5,
      boxShadow: active ? '0 1px 0 rgba(255,255,255,0.04) inset, 0 4px 12px rgba(0,0,0,0.3)' : 'none',
      transition: 'background 0.18s ease, color 0.18s ease',
    }}>{children}</button>
  )
}

/* ── Plan card ──────────────────────────────────────────────────────────── */

function PlanCard({ plan, billing, isCurrent, isPending, onSelect }) {
  const price = priceFor(plan, billing)
  const isPopular = plan.popular
  const cta = isCurrent ? 'Current Plan' : isPending ? 'Redirecting…' : plan.cta

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      style={{
        position: 'relative',
        padding: 26,
        borderRadius: 18,
        background: isPopular
          ? 'linear-gradient(180deg, rgba(76, 141, 255, 0.10), rgba(76, 141, 255, 0.02))'
          : 'var(--surface-2)',
        border: isPopular ? '1px solid rgba(76, 141, 255, 0.55)' : '1px solid var(--stroke)',
        boxShadow: isPopular ? '0 22px 60px -30px rgba(76, 141, 255, 0.55)' : 'none',
        display: 'flex', flexDirection: 'column',
        minHeight: 520,
      }}
    >
      {isPopular && (
        <div style={{
          position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)',
          padding: '5px 14px', borderRadius: 999, fontSize: 11, letterSpacing: 0.6, fontWeight: 700,
          background: 'linear-gradient(135deg, #4c8dff, #2f6bd9)', color: '#fff',
          border: '1px solid rgba(255,255,255,0.15)', textTransform: 'uppercase',
        }}>Most Popular</div>
      )}

      <div style={{ fontSize: 24, fontWeight: 700, color: plan.accent, marginBottom: 14 }}>
        {plan.name}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
        <span style={{ fontSize: 18, color: 'var(--text-2)' }}>$</span>
        <span style={{ fontSize: 44, fontWeight: 700, lineHeight: 1, color: 'var(--text-1)' }}>{price}</span>
        <span style={{ fontSize: 14, color: 'var(--text-3)' }}>/month</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 20 }}>
        {billing === 'yearly' ? 'if billed yearly' : 'billed monthly'}
      </div>

      <div style={{ height: 1, background: 'var(--stroke)', margin: '2px 0 18px' }} />

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12, flex: 1 }}>
        {plan.features.map((f) => (
          <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13.5, color: 'var(--text-2)' }}>
            <Check color={plan.accent} />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <button
        onClick={onSelect}
        disabled={isCurrent || isPending || plan.id === 'free'}
        style={{
          marginTop: 22, padding: '13px 16px', borderRadius: 12,
          border: 'none', cursor: isCurrent ? 'default' : 'pointer', width: '100%',
          fontSize: 14, fontWeight: 600,
          background: isCurrent
            ? 'var(--surface)'
            : isPopular
              ? 'linear-gradient(135deg, #4c8dff, #2f6bd9)'
              : 'var(--surface)',
          color: isCurrent ? 'var(--text-3)' : isPopular ? '#fff' : 'var(--text-1)',
          border: isPopular && !isCurrent ? 'none' : '1px solid var(--stroke)',
          transition: 'transform 0.15s ease, filter 0.15s ease',
        }}
        onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.filter = 'brightness(1.08)' }}
        onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
      >
        {cta}
      </button>
    </motion.div>
  )
}

function Check({ color = 'var(--mint)' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" style={{ flex: 'none', marginTop: 2 }} aria-hidden>
      <path d="M4 10.5l3.5 3.5L16 6" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
