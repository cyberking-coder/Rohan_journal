// Plans and entitlements — Master PRD §84.
//
// ── What this is, and what it is not ───────────────────────────────────────
// This is the entitlement layer: which plan a user is on, what that plan
// allows, and what happens at the edges. It does NOT take payment. Collecting
// money needs a Stripe account, a legal entity, terms, a refund policy and a
// tax position, none of which a library can invent — and wiring a real payment
// flow is a decision to make deliberately, not a side effect of a code change.
//
// The split is on purpose, and it is the right way round. The plumbing to
// Stripe is a day's work with good documentation. Deciding what a limit means
// when a user crosses it is where the subtle problems live, and that is what
// is built and tested here.
//
// ── The rule that governs every limit below ────────────────────────────────
// Downgrading must never destroy data. A user who cancels drops to Free and
// keeps everything they have — they simply cannot add more. Any other
// behaviour turns a billing failure, an expired card or a support mistake into
// permanent data loss, and no refund puts that back.

export const PLANS = {
  free: {
    id: 'free',
    label: 'Free',
    price: 0,
    blurb: 'The journal, in full, for one account.',
    features: [
      'Manual journal and CSV import',
      'Full analytics, tags and calendar',
      'One trading account',
      'Backtesting from your own candle files',
    ],
    limits: {
      brokerAccounts: 1,
      backtestSessions: 3,
      aiReportsPerWeek: 1,
      funded: 1,
      shareLinks: 1,
      autoSync: false,
      ictEngine: false,
      candleStorage: false,
    },
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    price: 12,
    blurb: 'Automatic sync and replay without files.',
    features: [
      'Everything in Free',
      'Automatic broker sync',
      'Market replay from stored candles',
      'Up to five trading accounts',
      'Weekly AI reports',
    ],
    limits: {
      brokerAccounts: 5,
      backtestSessions: 50,
      aiReportsPerWeek: 3,
      funded: 5,
      shareLinks: 10,
      autoSync: true,
      ictEngine: false,
      candleStorage: true,
    },
  },
  premium: {
    id: 'premium',
    label: 'Premium',
    price: 29,
    blurb: 'The ICT engine and unlimited everything.',
    features: [
      'Everything in Pro',
      'ICT/SMC detection engine',
      'Unlimited accounts, backtests and challenges',
      'Daily AI reports',
    ],
    limits: {
      brokerAccounts: Infinity,
      backtestSessions: Infinity,
      aiReportsPerWeek: 7,
      funded: Infinity,
      shareLinks: Infinity,
      autoSync: true,
      ictEngine: true,
      candleStorage: true,
    },
  },
}

export const PLAN_ORDER = ['free', 'pro', 'premium']
export const DEFAULT_PLAN = 'free'

// Human names for the limits, so a message can be assembled rather than
// hand-written per call site and then drift from the numbers.
//
// Plurals are given rather than derived. Appending "s" produces "AI report
// this weeks", and the alternative — a pluralisation helper — is a lot of
// machinery for five strings.
export const LIMIT_LABELS = {
  brokerAccounts: 'trading account',
  backtestSessions: 'saved backtest',
  aiReportsPerWeek: 'AI report this week',
  funded: 'funded challenge',
  shareLinks: 'share link',
}

export const LIMIT_PLURALS = {
  brokerAccounts: 'trading accounts',
  backtestSessions: 'saved backtests',
  aiReportsPerWeek: 'AI reports this week',
  funded: 'funded challenges',
  shareLinks: 'share links',
}

export function nounFor(key, count) {
  return count === 1 ? (LIMIT_LABELS[key] || key) : (LIMIT_PLURALS[key] || LIMIT_LABELS[key] || key)
}

export function getPlan(id) {
  return PLANS[id] || PLANS[DEFAULT_PLAN]
}

export function rank(id) {
  const i = PLAN_ORDER.indexOf(id)
  return i === -1 ? 0 : i
}

/**
 * Is a boolean feature switched on for this plan?
 *
 * Unknown feature names return false rather than true. A typo in a feature
 * name should lock a feature, never unlock one — the failure that costs
 * revenue is recoverable, the one that gives away the product is not.
 */
export function can(planId, feature) {
  const v = getPlan(planId).limits[feature]
  return v === true
}

export function limitFor(planId, key) {
  const v = getPlan(planId).limits[key]
  return typeof v === 'number' ? v : 0
}

/**
 * May the user add one more of something?
 *
 * `current` is what they already have. Note the asymmetry that makes the
 * no-data-loss rule work: this answers "can you add", never "should this be
 * taken away". Nothing in this module removes anything.
 */
export function allows(planId, key, current) {
  const limit = limitFor(planId, key)
  const have = Number(current) || 0
  const ok = have < limit
  return {
    ok,
    limit,
    have,
    remaining: Number.isFinite(limit) ? Math.max(0, limit - have) : Infinity,
    // Over the limit rather than merely at it: what a downgraded user looks
    // like. They keep everything and simply cannot add more, and the message
    // has to say that rather than implying something is about to vanish.
    over: have > limit,
    reason: ok ? null : message(planId, key, have, limit),
    upgrade: nextPlanFor(planId, key),
  }
}

function message(planId, key, have, limit) {
  const plural = nounFor(key, limit)
  const next = nextPlanFor(planId, key)

  if (have > limit) {
    return `Your plan includes ${limit} ${plural} and you have ${have}. Everything is still here and nothing will be deleted — you just can’t add more until you upgrade.`
  }
  return next
    ? `${getPlan(planId).label} includes ${limit} ${plural}. ${getPlan(next).label} raises this to ${describeLimit(limitFor(next, key))}.`
    : `You have reached the limit of ${limit} ${plural}.`
}

export function describeLimit(v) {
  return Number.isFinite(v) ? String(v) : 'unlimited'
}

/**
 * The cheapest plan that would actually solve this particular limit.
 *
 * Pointing at the most expensive plan for every limit is the pattern that
 * makes upgrade prompts feel like a shakedown, and users learn to ignore them.
 */
export function nextPlanFor(planId, key) {
  const from = rank(planId)
  const current = getPlan(planId).limits[key]
  for (let i = from + 1; i < PLAN_ORDER.length; i++) {
    const v = PLANS[PLAN_ORDER[i]].limits[key]
    const better = typeof v === 'boolean' ? v && !current : v > current
    if (better) return PLAN_ORDER[i]
  }
  return null
}

/**
 * Everything a downgrade would change, computed before it happens.
 *
 * Shown at the point of cancelling. A user who cancels and only afterwards
 * discovers that four of their five accounts have stopped syncing has been
 * ambushed, even though nothing was deleted.
 */
export function downgradeImpact(fromId, toId, usage = {}) {
  const from = getPlan(fromId)
  const to = getPlan(toId)
  const effects = []

  for (const [key, label] of Object.entries(LIMIT_LABELS)) {
    const before = from.limits[key]
    const after = to.limits[key]
    if (!(typeof after === 'number')) continue
    const have = Number(usage[key]) || 0
    if (after >= before) continue

    effects.push({
      key,
      label,
      before: describeLimit(before),
      after: describeLimit(after),
      have,
      // The reassurance is part of the data, not a nicety bolted on in the UI,
      // because it is the fact that decides whether this is alarming.
      keepsData: true,
      note: have > after
        ? `You have ${have}. All ${have} stay and keep working; you won’t be able to add more.`
        : null,
    })
  }

  for (const key of ['autoSync', 'ictEngine', 'candleStorage']) {
    if (from.limits[key] && !to.limits[key]) {
      effects.push({
        key,
        label: FEATURE_LABELS[key] || key,
        before: 'on',
        after: 'off',
        keepsData: true,
        note: key === 'candleStorage'
          ? 'Stored candles are kept but no new ones are uploaded. You can still replay from a file.'
          : 'Turns off. Nothing recorded by it is deleted.',
      })
    }
  }

  return effects
}

export const FEATURE_LABELS = {
  autoSync: 'Automatic broker sync',
  ictEngine: 'ICT/SMC engine',
  candleStorage: 'Stored candles for replay',
}

/**
 * Current usage in the shape `allows` and `downgradeImpact` expect.
 *
 * One function so a new limit cannot be checked against a count somebody
 * assembled differently at the call site.
 */
export function usageFrom({ brokerAccounts = [], backtestSessions = [], funded = [], shares = [], reportsThisWeek = 0 } = {}) {
  return {
    brokerAccounts: brokerAccounts.length,
    backtestSessions: backtestSessions.length,
    funded: funded.length,
    shareLinks: shares.length,
    aiReportsPerWeek: reportsThisWeek,
  }
}
