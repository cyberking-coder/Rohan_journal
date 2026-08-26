// Subscription state — the pure half of Phase 11.
//
// Split from useSubscription.js so it can be tested without React or a
// Supabase client, the same way sharing.js sits under useShares.js. The rules
// below decide money, and a rule that decides money should be exercisable in
// a plain test file.

import { DEFAULT_PLAN, PLANS } from './plans.js'

// Statuses that still grant the plan. `past_due` is included on purpose: a
// customer whose card just failed is still a customer, and Stripe will retry
// for days. Locking them out on the first failure loses people who would have
// paid.
const LIVE = new Set(['active', 'trialing', 'past_due'])

export function resolvePlan(row) {
  if (!row) return DEFAULT_PLAN
  if (!LIVE.has(row.status)) return DEFAULT_PLAN
  if (row.current_period_end) {
    // A day of grace, matching the SQL. Being an hour early to downgrade
    // someone who paid is a worse error than being a day late.
    const end = new Date(row.current_period_end).getTime() + 86400000
    if (Number.isFinite(end) && end < Date.now()) return DEFAULT_PLAN
  }
  return PLANS[row.plan] ? row.plan : DEFAULT_PLAN
}

/**
 * How to describe the subscription's state in one line.
 *
 * `cancel_at_period_end` is the case worth getting right: the customer has
 * cancelled but has paid through the end of the month, and telling them their
 * plan is "cancelled" while they still have it is both wrong and a support
 * ticket.
 */
export function describeStatus(row) {
  if (!row) return { tone: 'neutral', text: 'No subscription — you’re on the free plan.' }

  const ends = row.current_period_end
    ? new Date(row.current_period_end).toLocaleDateString()
    : null

  if (row.cancel_at_period_end && LIVE.has(row.status)) {
    return {
      tone: 'warn',
      text: ends
        ? `Cancelled — you keep this plan until ${ends}, then move to Free.`
        : 'Cancelled — you keep this plan until the end of the current period.',
    }
  }

  switch (row.status) {
    case 'trialing':
      return { tone: 'good', text: ends ? `Trial, ends ${ends}.` : 'On trial.' }
    case 'active':
      return { tone: 'good', text: ends ? `Active — renews ${ends}.` : 'Active.' }
    case 'past_due':
      return {
        tone: 'warn',
        text: 'Your last payment failed. You keep full access while Stripe retries — update your card to avoid losing it.',
      }
    case 'unpaid':
      return { tone: 'bad', text: 'Unpaid after several attempts. Update your card to restore your plan.' }
    case 'canceled':
      return { tone: 'neutral', text: 'Cancelled. You’re on the free plan.' }
    case 'incomplete':
      return { tone: 'warn', text: 'Payment didn’t finish. Nothing has been charged.' }
    case 'paused':
      return { tone: 'neutral', text: 'Paused.' }
    default:
      return { tone: 'neutral', text: row.status }
  }
}
