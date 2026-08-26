// Community.
//
// This is the one feature that shows users to each other, so the tests are
// mostly about what must NOT happen:
//
//   • no currency in anything publishable — the rule the whole design rests on
//   • no verified badge on a sample containing one hand-entered trade
//   • no leaderboard entry from a four-trade sample
//   • nothing visible at all without an explicit opt-in
//
// The first of those is checked structurally rather than by inspection: the
// publishable object is walked and any field that looks like money fails.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MIN_DAYS, MIN_TRADES, REPORT_REASONS, checkHandle, describeProvenance,
  eligibility, normaliseSymbols, publishableStats, rUnit, validateSetup, withRanks,
} from '../src/lib/community.js'

let checks = 0
function ok(c, m) { assert.ok(c, m); checks++ }
function eq(a, b, m) { assert.deepEqual(a, b, m); checks++ }
function near(a, b, m, tol = 1e-6) { assert.ok(Math.abs(a - b) < tol, `${m}: ${a} vs ${b}`); checks++ }

const DAY = 86400000
const T0 = Date.UTC(2026, 5, 1, 12, 0)

// A trade `day` days in, worth `pnl`, from `source`.
const t = (pnl, day = 0, source = 'mt5') => ({
  pnl, fees: 0, source,
  closed_at: new Date(T0 + day * DAY).toISOString(),
  traded_at: new Date(T0 + day * DAY).toISOString(),
})

// n trades over `days` distinct days, `wins` of them winners.
function set({ n, wins, win = 200, loss = 100, days = 12, source = 'mt5' }) {
  return Array.from({ length: n }, (_, i) => t(i < wins ? win : -loss, i % days, source))
}

// ── handles ────────────────────────────────────────────────────────────────
{
  eq(checkHandle('trader_99').ok, true, 'a normal handle')
  eq(checkHandle('trader_99').handle, 'trader_99', 'returned cleaned')
  eq(checkHandle('  spaced  ').handle, 'spaced', 'trimmed')

  eq(checkHandle('ab').ok, false, 'too short')
  eq(checkHandle('x'.repeat(21)).ok, false, 'too long')
  eq(checkHandle('has space').ok, false, 'no spaces')
  eq(checkHandle('emoji🙂').ok, false, 'no emoji — they make impersonation trivial')
  eq(checkHandle('semi;colon').ok, false, 'no punctuation')
  eq(checkHandle('').ok, false, 'empty')
  eq(checkHandle(null).ok, false, 'null')

  // Not a security control, but it should not be effortless.
  eq(checkHandle('admin').ok, false, 'reserved')
  eq(checkHandle('SUPPORT').ok, false, 'reserved regardless of case')

  // Every rejection explains itself — an unexplained form error is one people
  // abandon signup over.
  for (const bad of ['ab', 'has space', '', 'admin']) {
    ok(checkHandle(bad).reason?.length > 5, `"${bad}" is rejected with a reason`)
  }
}

// ── the R unit ─────────────────────────────────────────────────────────────
{
  near(rUnit([t(300), t(-100), t(-200)]), 150, 'the average losing trade')
  eq(rUnit([t(100), t(200)]), null, 'undefined with no losers — NOT substituted with 1')
  eq(rUnit([]), null, 'undefined with no trades')
  eq(rUnit([{ ...t(-100), status: 'open' }]), null, 'a floating loss is not a realised one')
  near(rUnit([{ pnl: 0, fees: 50, closed_at: t(0).closed_at }]), 50, 'fees make a loser')
}

// ── nothing publishable may be money ───────────────────────────────────────
//
// The rule the entire feature rests on. Checked by walking the object rather
// than by listing fields, so a field added later is covered too.
{
  const stats = publishableStats(set({ n: 40, wins: 20, win: 5000, loss: 2500 }))

  const MONEY = /pnl|profit$|balance|equity|cash|amount|total|gross|dollar|usd|net$/i
  for (const key of Object.keys(stats)) {
    ok(!MONEY.test(key), `publishable stats contain no money-shaped field: "${key}"`)
  }

  // And no value that happens to BE one of the raw currency amounts. With
  // 5,000 winners and 2,500 losers, either figure appearing means a leak.
  for (const [key, v] of Object.entries(stats)) {
    if (typeof v !== 'number') continue
    ok(v !== 5000 && v !== 2500 && v !== 50000,
      `"${key}" is not a raw currency amount (${v})`)
  }

  // Doubling every amount must not change a single published figure — the
  // strongest statement that account size is absent.
  const small = publishableStats(set({ n: 40, wins: 20, win: 200, loss: 100 }))
  const large = publishableStats(set({ n: 40, wins: 20, win: 20000, loss: 10000 }))
  eq(small.winRate, large.winRate, 'win rate is scale-free')
  eq(small.profitFactor, large.profitFactor, 'profit factor is scale-free')
  eq(small.expectancyR, large.expectancyR, 'expectancy in R is scale-free')
  eq(small.trades, large.trades, 'as is the count')
}

// ── the stats themselves ───────────────────────────────────────────────────
{
  const s = publishableStats([t(300, 0), t(-100, 0), t(-200, 1), t(100, 2)])
  eq(s.trades, 4, 'four trades')
  eq(s.winRate, 50, 'win rate')
  eq(s.tradingDays, 3, 'three distinct days')
  near(s.profitFactor, 1.33, 'profit factor, rounded for display', 0.001)
  // net 100 over 4 trades = 25/trade; R unit = 150 → 0.167
  near(s.expectancyR, 0.167, 'expectancy in R', 0.001)
  ok(s.from < s.to, 'the window runs forwards')

  const noLosers = publishableStats([t(100), t(200)])
  eq(noLosers.expectancyR, null, 'no R without a loss — not Infinity, not zero')
  eq(noLosers.profitFactor, null, 'and no profit factor either')

  const empty = publishableStats([])
  eq(empty.trades, 0, 'empty')
  eq(empty.from, null, 'with no window')
  eq(empty.verified, false, 'and nothing to verify')

  // Open trades carry floating P&L and must not be published as results.
  const withOpen = publishableStats([t(100, 0), { ...t(-9000, 0), status: 'open' }])
  eq(withOpen.trades, 1, 'open trades excluded')
}

// ── the verified badge ─────────────────────────────────────────────────────
{
  eq(publishableStats(set({ n: 30, wins: 15, source: 'mt5' })).verified, true,
    'a fully synced sample is verified')

  // One hand-entered trade is all it takes to change the numbers, so it is all
  // it takes to lose the badge.
  const mixed = [...set({ n: 29, wins: 15 }), t(500, 3, 'manual')]
  eq(publishableStats(mixed).verified, false,
    'ONE manual trade removes the badge from an otherwise synced sample')

  eq(publishableStats(set({ n: 30, wins: 15, source: 'manual' })).verified, false,
    'a hand-kept journal is not verified')
  eq(publishableStats([]).verified, false, 'and neither is nothing')

  // The badge must be described honestly on both sides.
  const good = describeProvenance({ verified: true })
  eq(good.tone, 'good', 'synced reads positively')
  ok(/synced broker/i.test(good.text), 'and says what it means')

  const plain = describeProvenance({ verified: false })
  ok(/can’t be verified/.test(plain.text), 'self-reported says so plainly')
  ok(plain.tone !== 'bad', 'without treating an honest journal as an accusation')

  eq(describeProvenance({ stat_verified: true }).short, 'Synced',
    'the database column name is accepted too')
  eq(describeProvenance(null).short, 'Self-reported', 'and nothing defaults to unverified')
}

// ── eligibility ────────────────────────────────────────────────────────────
{
  const good = eligibility(set({ n: 25, wins: 12, days: 12 }))
  eq(good.eligible, true, 'enough trades over enough days')
  eq(good.missing.length, 0, 'nothing missing')

  // The case the thresholds exist for: a perfect record on a tiny sample.
  const tiny = eligibility(set({ n: 4, wins: 4, days: 4 }))
  eq(tiny.eligible, false, 'four winning trades is not a leaderboard entry')
  ok(tiny.missing.length >= 2, 'and it says what is missing')
  ok(tiny.missing.some((m) => /closed trade/.test(m)), 'naming the trade count')

  const fewDays = eligibility(set({ n: 30, wins: 15, days: 3 }))
  eq(fewDays.eligible, false, 'thirty trades over three days is not enough')
  ok(fewDays.missing.some((m) => /trading day/.test(m)), 'the day count is named')

  // No losses means no R, which means no comparable score.
  const noLoss = eligibility(Array.from({ length: 25 }, (_, i) => t(100, i % 12)))
  eq(noLoss.eligible, false, 'a spotless record cannot be scored')
  ok(noLoss.missing.some((m) => /losing trade/.test(m)), 'and it explains why')

  eq(eligibility([]).eligible, false, 'nothing is not eligible')
  eq(MIN_TRADES, 20, 'the trade threshold is stated once')
  eq(MIN_DAYS, 10, 'as is the day threshold')
}

// ── setups ─────────────────────────────────────────────────────────────────
{
  const good = validateSetup({
    title: 'London sweep into FVG',
    thesis: 'Wait for Asian range liquidity to be taken, then enter on the return into the gap.',
    tags: ['FVG', 'Fair Value Gap', 'liquidity-sweep'],
    symbols: ['eurusd', 'EURUSD', 'xauusd.s'],
  })
  eq(good.ok, true, 'a complete setup validates')
  eq(good.clean.tags, ['fvg', 'liquidity-sweep'], 'tags are normalised and deduplicated')
  eq(good.clean.symbols, ['EURUSD', 'XAUUSD.S'], 'symbols are uppercased and deduplicated')

  eq(validateSetup({ title: 'ab', thesis: 'x'.repeat(50) }).ok, false, 'a stub title is rejected')
  eq(validateSetup({ title: 'Fine title', thesis: 'too short' }).ok, false, 'a stub thesis is rejected')
  eq(validateSetup({}).ok, false, 'an empty draft is rejected')

  // Errors must be readable. A raw Postgres constraint name is not something
  // to put in front of a person.
  const bad = validateSetup({ title: '', thesis: '' })
  for (const [field, msg] of Object.entries(bad.errors)) {
    ok(!/constraint|violates|null value/i.test(msg), `${field}: the message is human`)
    ok(msg.length > 8, `${field}: and actually says something`)
  }

  eq(normaliseSymbols(Array.from({ length: 20 }, (_, i) => `SYM${i}`)).length, 8, 'symbols are capped')
  eq(normaliseSymbols(null), [], 'null is handled')

  // Every report reason must be a readable phrase, since these are radio
  // labels a user reads under stress.
  for (const [key, label] of Object.entries(REPORT_REASONS)) {
    ok(label.length > 5 && /[a-z]/.test(label), `report reason "${key}" is readable`)
  }
}

// ── ranking ────────────────────────────────────────────────────────────────
{
  const ranked = withRanks([
    { handle: 'a', expectancy_r: 0.9 },
    { handle: 'b', expectancy_r: 0.5 },
    { handle: 'c', expectancy_r: 0.5 },
    { handle: 'd', expectancy_r: 0.1 },
  ])
  eq(ranked.map((r) => r.rank), [1, 2, 2, 4], 'ties share a rank, and the next place skips')
  eq(withRanks([]).length, 0, 'nothing to rank')
  eq(withRanks(null).length, 0, 'null is handled')
}

// ── the migration must match what this file promises ───────────────────────
//
// The client copy of a rule is for drawing the UI; the database decides. These
// check the two have not drifted, and that the properties this feature was
// allowed to ship on are actually in the SQL.
{
  const sql = readFileSync(new URL('../supabase/community.sql', import.meta.url), 'utf8')

  ok(/min_trades constant int := 20/.test(sql), 'the database uses the same trade threshold')
  ok(/min_days\s+constant int := 10/.test(sql), 'and the same day threshold')

  // Opt-in. A community feature that enrolls people quietly is a privacy
  // incident with a friendly name.
  ok(/on_leaderboard boolean not null default false/.test(sql), 'the leaderboard is opt-in')
  ok(/publishes\s+boolean not null default false/.test(sql), 'so is publishing')
  ok(/published\s+boolean not null default false/.test(sql), 'and a setup starts unpublished')

  // One door, as in phase 9.
  ok(/security definer/.test(sql), 'cross-tenant reads go through SECURITY DEFINER functions')
  ok(!/on public\.trades\s+for select using \(true\)/.test(sql),
    'and `trades` gets no permissive policy')

  // Moderation must not be self-service.
  ok(/grant execute on function public\.leaderboard\(int, int\) to authenticated;/.test(sql),
    'the leaderboard is for signed-in users, not the internet')
  ok(!/grant execute on function public\.moderate_/.test(sql),
    'moderation functions are granted to nobody')
  ok(/suspended may not be changed here/.test(sql),
    'a user cannot lift their own suspension')
  ok(/removed may not be changed here/.test(sql),
    'nor restore their own removed setup')

  ok(/create table if not exists public\.content_reports/.test(sql),
    'there is a way to report content — shipping without one is a missing decision')
}

console.log(`community: ${checks} assertions passed`)
