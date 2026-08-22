// Plans and entitlements.
//
// The rule the whole module answers to: downgrading must never destroy data.
// A user who cancels keeps everything and simply cannot add more. Any other
// behaviour turns an expired card into permanent data loss, so most of these
// assertions are about what does NOT happen.

import assert from 'node:assert/strict'
import {
  DEFAULT_PLAN, LIMIT_LABELS, PLANS, PLAN_ORDER, allows, can, describeLimit,
  LIMIT_PLURALS, downgradeImpact, getPlan, limitFor, nextPlanFor, nounFor,
  rank, usageFrom,
} from '../src/lib/plans.js'

let checks = 0
function ok(c, m) { assert.ok(c, m); checks++ }
function eq(a, b, m) { assert.deepEqual(a, b, m); checks++ }

// ── the plan table is internally consistent ────────────────────────────────
{
  eq(PLAN_ORDER.length, new Set(PLAN_ORDER).size, 'no plan listed twice')
  ok(PLAN_ORDER.every((id) => PLANS[id]), 'every ordered id exists')
  eq(Object.keys(PLANS).sort(), [...PLAN_ORDER].sort(), 'and every plan is ordered')
  ok(PLANS[DEFAULT_PLAN], 'the default plan exists')
  eq(DEFAULT_PLAN, 'free', 'and is the free one')

  // Limits must be monotonic up the ladder, or a user could pay more for less
  // — which is both a bug and the sort of thing nobody notices for months.
  const keys = Object.keys(PLANS.free.limits)
  for (const key of keys) {
    for (let i = 1; i < PLAN_ORDER.length; i++) {
      const lower = PLANS[PLAN_ORDER[i - 1]].limits[key]
      const higher = PLANS[PLAN_ORDER[i]].limits[key]
      if (typeof lower === 'boolean') {
        ok(higher || !lower, `${key}: ${PLAN_ORDER[i]} does not switch off what ${PLAN_ORDER[i - 1]} had`)
      } else {
        ok(higher >= lower, `${key}: ${PLAN_ORDER[i]} is not smaller than ${PLAN_ORDER[i - 1]}`)
      }
    }
  }

  // Every plan defines every limit. A missing key reads as 0 or false, which
  // would silently lock a feature on a plan that is meant to include it.
  for (const id of PLAN_ORDER) {
    eq(Object.keys(PLANS[id].limits).sort(), keys.sort(), `${id} defines every limit`)
    ok(PLANS[id].label, `${id} has a label`)
    ok(Array.isArray(PLANS[id].features) && PLANS[id].features.length, `${id} lists what you get`)
    ok(typeof PLANS[id].price === 'number', `${id} has a price`)
  }

  // Prices increase with the ladder.
  for (let i = 1; i < PLAN_ORDER.length; i++) {
    ok(PLANS[PLAN_ORDER[i]].price > PLANS[PLAN_ORDER[i - 1]].price,
      `${PLAN_ORDER[i]} costs more than ${PLAN_ORDER[i - 1]}`)
  }

  // Every numeric limit has a label, or a limit message says "brokerAccounts".
  for (const key of keys) {
    if (typeof PLANS.free.limits[key] === 'number') {
      ok(LIMIT_LABELS[key], `${key} has a human label`)
    }
  }
}

// ── lookups fail closed ────────────────────────────────────────────────────
{
  eq(getPlan('nonsense').id, 'free', 'an unknown plan falls back to free')
  eq(getPlan(null).id, 'free', 'so does null')
  eq(getPlan(undefined).id, 'free', 'and undefined')

  // A typo in a feature name must lock, never unlock. Giving the product away
  // is the unrecoverable failure; charging someone who should have had it is
  // a support ticket.
  eq(can('premium', 'notAFeature'), false, 'an unknown feature is off even on the top plan')
  eq(can('free', 'autoSync'), false, 'free has no auto sync')
  eq(can('pro', 'autoSync'), true, 'pro does')
  eq(can('pro', 'ictEngine'), false, 'the ICT engine is premium only')
  eq(can('premium', 'ictEngine'), true, 'and premium has it')
  // A numeric limit is not a boolean feature.
  eq(can('premium', 'brokerAccounts'), false, 'a count is not a switch')

  eq(limitFor('free', 'brokerAccounts'), 1, 'free is one account')
  eq(limitFor('premium', 'brokerAccounts'), Infinity, 'premium is unlimited')
  eq(limitFor('free', 'autoSync'), 0, 'a boolean read as a number is zero, not NaN')
  eq(limitFor('free', 'nothing'), 0, 'an unknown limit is zero')

  eq(rank('free'), 0, 'ranked')
  ok(rank('premium') > rank('pro'), 'and ordered')
  eq(rank('nonsense'), 0, 'an unknown plan ranks lowest')

  eq(describeLimit(5), '5', 'a number')
  eq(describeLimit(Infinity), 'unlimited', 'and infinity reads as a word')
}

// ── allows ─────────────────────────────────────────────────────────────────
{
  const under = allows('free', 'brokerAccounts', 0)
  eq(under.ok, true, 'room for one')
  eq(under.remaining, 1, 'one left')
  eq(under.reason, null, 'nothing to explain')

  const at = allows('free', 'brokerAccounts', 1)
  eq(at.ok, false, 'at the limit, no more')
  eq(at.remaining, 0, 'none left')
  eq(at.over, false, 'but not over it')
  ok(/Pro/.test(at.reason), 'and the message names the plan that would help')
  eq(at.upgrade, 'pro', 'which is the cheapest one that actually helps')

  // The downgraded user. This is the case the no-data-loss rule is about.
  const over = allows('free', 'brokerAccounts', 4)
  eq(over.ok, false, 'cannot add more')
  eq(over.over, true, 'and is over the limit')
  eq(over.remaining, 0, 'with nothing remaining')
  ok(/nothing will be deleted/.test(over.reason), 'the message promises nothing is deleted')
  ok(/still here/.test(over.reason), 'and that what they have is still there')

  const unlimited = allows('premium', 'brokerAccounts', 999)
  eq(unlimited.ok, true, 'unlimited means unlimited')
  eq(unlimited.remaining, Infinity, 'with infinite headroom')

  eq(allows('free', 'brokerAccounts', null).have, 0, 'a null count reads as none')
  eq(allows('free', 'brokerAccounts', 'x').have, 0, 'so does nonsense')
}

// ── the upgrade pointed at is the cheapest that helps ──────────────────────
{
  eq(nextPlanFor('free', 'autoSync'), 'pro', 'sync arrives at Pro, so Pro is suggested')
  eq(nextPlanFor('free', 'ictEngine'), 'premium', 'the ICT engine only exists on Premium')
  eq(nextPlanFor('pro', 'ictEngine'), 'premium', 'from Pro it is the next step')
  eq(nextPlanFor('premium', 'ictEngine'), null, 'nothing above the top plan')
  eq(nextPlanFor('premium', 'brokerAccounts'), null, 'nor for an unlimited count')

  // Never point past a plan that would have solved it — that reads as a
  // shakedown and teaches users to ignore the prompt.
  eq(nextPlanFor('free', 'brokerAccounts'), 'pro', 'Pro solves the account limit, so Pro it is')
}

// ── downgrade impact ───────────────────────────────────────────────────────
{
  const usage = usageFrom({
    brokerAccounts: [1, 2, 3],
    backtestSessions: Array(12).fill(0),
    funded: [1, 2],
    shares: [1],
    reportsThisWeek: 2,
  })
  eq(usage.brokerAccounts, 3, 'usage counts accounts')
  eq(usage.backtestSessions, 12, 'and sessions')
  eq(usage.aiReportsPerWeek, 2, 'and reports used this week')
  eq(usageFrom().brokerAccounts, 0, 'an empty usage is all zeros')

  const effects = downgradeImpact('pro', 'free', usage)
  ok(effects.length > 0, 'a downgrade has effects')
  ok(effects.every((e) => e.keepsData), 'and every one of them keeps the data')

  const accounts = effects.find((e) => e.key === 'brokerAccounts')
  ok(accounts, 'the account limit is affected')
  eq(accounts.before, '5', 'from five')
  eq(accounts.after, '1', 'to one')
  eq(accounts.have, 3, 'with three in use')
  ok(/All 3 stay/.test(accounts.note), 'and all three are kept')
  ok(/won’t be able to add/.test(accounts.note), 'the restriction is on adding')

  const sync = effects.find((e) => e.key === 'autoSync')
  ok(sync, 'losing sync is listed')
  eq(sync.after, 'off', 'it turns off')
  ok(/Nothing.*deleted/.test(sync.note), 'without deleting anything')

  // A limit the user is under still shows as a change, but without alarm.
  const shares = effects.find((e) => e.key === 'shareLinks')
  ok(shares, 'the share limit changes too')
  eq(shares.note, null, 'but with no warning, since they are under it')

  // Upgrading has no downgrade effects.
  eq(downgradeImpact('free', 'premium', usage).length, 0, 'moving up costs nothing')
  eq(downgradeImpact('pro', 'pro', usage).length, 0, 'and staying put changes nothing')

  // Premium to free: everything at once, and still nothing destroyed.
  const big = downgradeImpact('premium', 'free', usage)
  ok(big.length >= 5, 'the biggest downgrade lists many effects')
  ok(big.every((e) => e.keepsData), 'and still destroys nothing')
  ok(big.some((e) => e.key === 'ictEngine'), 'including losing the ICT engine')
}


// ── plurals ────────────────────────────────────────────────────────────────
//
// Found in the browser: appending "s" to the labels produced "AI report this
// weeks" on the billing page.
{
  eq(nounFor('brokerAccounts', 1), 'trading account', 'singular')
  eq(nounFor('brokerAccounts', 2), 'trading accounts', 'plural')
  eq(nounFor('aiReportsPerWeek', 1), 'AI report this week', 'a label with a trailing phrase, singular')
  eq(nounFor('aiReportsPerWeek', 3), 'AI reports this week', 'and pluralised in the right place')
  eq(nounFor('unknown', 2), 'unknown', 'an unlabelled key falls back to its own name')

  for (const key of Object.keys(LIMIT_LABELS)) {
    ok(LIMIT_PLURALS[key], `${key} has a plural`)
    ok(!/ss$|ks$|weeks$/.test(nounFor(key, 2)) || key === 'shareLinks',
      `${key} pluralises without mangling`)
  }

  // The limit message uses them, so it reads correctly at 1 and at many.
  ok(/1 trading account\./.test(allows('free', 'brokerAccounts', 1).reason.replace(/\s+/g, ' ')),
    'a limit of one reads as singular')
  ok(/5 trading accounts/.test(allows('pro', 'brokerAccounts', 5).reason),
    'and a limit of five reads as plural')
}

console.log(`plans: ${checks} assertions passed`)
