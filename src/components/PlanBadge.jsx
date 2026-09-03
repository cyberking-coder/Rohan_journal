import { useSubscription } from '../lib/billing'

// A pill users see next to their name once they upgrade — a tiny visual
// reward that the site knows they're paying, and a natural anchor for
// "you are on Pro" in the top bar and profile card.
//
// Nothing renders for Free users; upgrading changes the sidebar/topbar
// subtly without adding chrome for people who haven't paid.

const STYLES = {
  pro: {
    label: 'PRO',
    color: '#fff',
    background: 'linear-gradient(135deg, #4c8dff, #2f6bd9)',
    ring: 'rgba(76,141,255,0.55)',
  },
  elite: {
    label: 'ELITE',
    color: '#04140d',
    background: 'linear-gradient(135deg, #ffdd7a, #f5a524)',
    ring: 'rgba(245,165,36,0.65)',
  },
}

export default function PlanBadge({ size = 'sm', title }) {
  const { sub } = useSubscription()
  const plan = sub?.plan ?? 'free'
  if (plan === 'free') return null

  const s = STYLES[plan]
  if (!s) return null

  const pad = size === 'md' ? '4px 10px' : '2px 8px'
  const font = size === 'md' ? 11 : 10

  return (
    <span
      title={title ?? `${s.label} member`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: pad, borderRadius: 999,
        background: s.background, color: s.color,
        fontSize: font, fontWeight: 800, letterSpacing: 0.7, lineHeight: 1,
        boxShadow: `0 0 0 1px ${s.ring}, 0 6px 14px -6px ${s.ring}`,
        textTransform: 'uppercase', flexShrink: 0,
      }}
    >
      {plan === 'elite' && <StarIcon />} {s.label}
    </span>
  )
}

function StarIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 20 20" aria-hidden>
      <path d="M10 1.5l2.6 5.4 5.9.9-4.3 4.2 1 5.9L10 15.1 4.8 17.9l1-5.9L1.5 7.8l5.9-.9L10 1.5z" fill="currentColor" />
    </svg>
  )
}
