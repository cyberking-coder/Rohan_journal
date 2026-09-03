// Single source of truth for the pricing plans and their features.
// Kept as data so the Pricing page, Settings billing section and any future
// gating check read from the same list.

export const PLANS = [
  {
    id: 'free',
    name: 'Free',
    accent: 'var(--text-1)',
    monthly: 0,
    yearly: 0,
    tagline: 'Start logging trades by hand.',
    features: [
      'Up to 15 trades per month',
      'Manual trade entry',
      'Basic analytics & charts',
      'Economic calendar (today only)',
    ],
    cta: 'Current Plan',
  },
  {
    id: 'pro',
    name: 'Pro',
    accent: 'var(--blue, #4c8dff)',
    monthly: 12.99,
    yearly: 10.99,
    popular: true,
    tagline: 'Cloud sync, AI, and the full analytics suite.',
    features: [
      'Unlimited trades',
      '3 MT4/MT5 accounts with real-time sync',
      'AI-powered trade reports',
      'Full analytics & charts',
      'Community chat access',
      'Economic calendar & news data',
    ],
    cta: 'Get Started',
  },
  {
    id: 'elite',
    name: 'Elite',
    accent: 'var(--mint)',
    monthly: 22.99,
    yearly: 19.99,
    tagline: 'Everything, uncapped, with VIP support.',
    features: [
      'Everything in Pro',
      'Unlimited MT4/MT5 accounts',
      'Backtesting engine',
      'AI news analysis',
      'Traders Lounge access',
      'VIP & mentor support',
      'Priority support',
    ],
    cta: 'Select Plan',
  },
]

export const PLAN_LIMITS = {
  free:  { tradesPerMonth: 15, connectedAccounts: 0, ai: false, backtesting: false },
  pro:   { tradesPerMonth: Infinity, connectedAccounts: 3, ai: true, backtesting: false },
  elite: { tradesPerMonth: Infinity, connectedAccounts: Infinity, ai: true, backtesting: true },
}

export function priceFor(plan, billing) {
  return billing === 'yearly' ? plan.yearly : plan.monthly
}
