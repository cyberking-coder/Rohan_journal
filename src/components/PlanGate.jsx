import { useSubscription } from '../lib/billing'
import { hasFeature, PLANS, requiredPlanFor } from '../lib/plans'

// Wraps a feature. If the user's plan is high enough, renders children.
// Otherwise renders a friendly locked screen with a link to Pricing.
//
// Usage:
//   <PlanGate feature="ai"><AIReport ... /></PlanGate>

export default function PlanGate({ feature, children, title, description }) {
  const { sub, loading } = useSubscription()
  if (loading) return null

  if (hasFeature(sub?.plan ?? 'free', feature)) return children

  const min = requiredPlanFor(feature)
  const plan = PLANS.find((p) => p.id === min)

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', padding: '60px 24px', minHeight: 360,
      borderRadius: 18, background: 'var(--surface-2)', border: '1px solid var(--stroke)',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, rgba(76,141,255,0.18), rgba(76,141,255,0.05))',
        border: '1px solid rgba(76,141,255,0.35)', marginBottom: 18,
      }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="4" y="10" width="16" height="10" rx="2" stroke="var(--blue, #4c8dff)" strokeWidth="1.8" />
          <path d="M8 10V7a4 4 0 018 0v3" stroke="var(--blue, #4c8dff)" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
        {title ?? `${plan?.name ?? 'Pro'} feature`}
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--text-3)', maxWidth: 420, marginBottom: 22 }}>
        {description ?? `Available on ${plan?.name ?? 'Pro'} and above. Upgrade to unlock this and the rest of the ${plan?.name ?? 'Pro'} feature set.`}
      </div>
      <a href="?view=pricing" style={{
        padding: '12px 22px', borderRadius: 12, textDecoration: 'none',
        background: 'linear-gradient(135deg, #4c8dff, #2f6bd9)', color: '#fff',
        fontSize: 14, fontWeight: 600,
      }}>
        Upgrade to {plan?.name ?? 'Pro'}
      </a>
    </div>
  )
}
