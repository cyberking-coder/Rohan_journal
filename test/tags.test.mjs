// Trade tags — normalisation, filtering and the performance tables.
//
// The parts worth pinning down are the ones where a plausible implementation
// quietly lies: near-duplicate tags splitting a report in two, a multi-tagged
// trade being counted several times, and small samples being presented as
// findings.

import assert from 'node:assert/strict'
import {
  CATALOGUE, byCategory, filterByTags, mistakeCost, normaliseTag, normaliseTags,
  slugify, tagInfo, tagPerformance, usedTags,
} from '../src/lib/tags.js'

let checks = 0
function ok(c, m) { assert.ok(c, m); checks++ }
function eq(a, b, m) { assert.deepEqual(a, b, m); checks++ }
function near(a, b, m) { assert.ok(Math.abs(a - b) < 1e-6, `${m}: ${a} vs ${b}`); checks++ }

const t = (pnl, tags, extra = {}) => ({
  pnl, fees: 0, tags, traded_at: '2026-03-02T10:00:00Z', ...extra,
})

// ── slugs ──────────────────────────────────────────────────────────────────
{
  eq(slugify('Fair Value Gap'), 'fair-value-gap', 'spaces become hyphens')
  eq(slugify('  FVG  '), 'fvg', 'trimmed and lowercased')
  eq(slugify('Break of Structure!!'), 'break-of-structure', 'punctuation dropped')
  eq(slugify('a---b'), 'a-b', 'runs collapse')
  eq(slugify('---'), '', 'nothing but punctuation is nothing')
  eq(slugify(null), '', 'null is nothing')
  ok(slugify('x'.repeat(80)).length <= 40, 'slugs are capped')

  // The point of the alias table: three spellings, one tag.
  eq(normaliseTag('Fair Value Gap'), 'fvg', 'long form aliases to the short')
  eq(normaliseTag('FVG'), 'fvg', 'short form stays')
  eq(normaliseTag('fvg'), 'fvg', 'already normalised')
  eq(normaliseTag('Revenge Trading'), 'revenge-trade', 'mistake aliases too')
  eq(normaliseTag('  '), null, 'blank is not a tag')

  // An unknown tag is still a tag. The taxonomy must not be a whitelist.
  eq(normaliseTag('My Weird Setup'), 'my-weird-setup', 'custom tags survive')
  eq(tagInfo('my-weird-setup').category, 'custom', 'and are categorised as custom')
  eq(tagInfo('my-weird-setup').label, 'My Weird Setup', 'with a readable label')
  eq(tagInfo('fvg').category, 'concept', 'known concepts keep their category')
  eq(tagInfo('moved-stop').category, 'mistake', 'known mistakes too')
  eq(tagInfo('fvg').label, 'Fair Value Gap', 'and their proper label')
}

{
  // Duplicates in any spelling collapse to one.
  eq(normaliseTags(['FVG', 'Fair Value Gap', 'fvg']), ['fvg'], 'deduplicated across spellings')
  eq(normaliseTags(['bos', '', null, 'choch']), ['bos', 'choch'], 'blanks dropped')
  eq(normaliseTags(null), [], 'null list is empty')
  eq(normaliseTags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, 12, 'capped at 12')
  eq(normaliseTags(['b', 'a']), ['b', 'a'], 'order preserved')

  // Every catalogue slug must survive normalisation unchanged, or the picker
  // would insert tags that no filter could ever match.
  const unstable = CATALOGUE.filter((c) => normaliseTag(c.slug) !== c.slug)
  eq(unstable.map((c) => c.slug), [], 'every catalogue slug is already normal')

  // And no duplicate slugs in the catalogue.
  const slugs = CATALOGUE.map((c) => c.slug)
  eq(slugs.length, new Set(slugs).size, 'catalogue slugs are unique')
}

// ── filtering ──────────────────────────────────────────────────────────────
{
  const trades = [
    t(100, ['fvg', 'bos']),
    t(-50, ['fvg', 'moved-stop']),
    t(200, ['order-block']),
    t(10, []),
  ]

  eq(filterByTags(trades, []).length, 4, 'no selection filters nothing')
  eq(filterByTags(trades, ['fvg']).length, 2, 'one tag')
  eq(filterByTags(trades, ['fvg', 'order-block'], 'any').length, 3, 'any-of')
  eq(filterByTags(trades, ['fvg', 'bos'], 'all').length, 1, 'all-of is narrower')
  eq(filterByTags(trades, ['fvg', 'order-block'], 'all').length, 0, 'all-of with no overlap')

  // The selection is normalised too, so a filter typed as "Fair Value Gap"
  // matches trades tagged "fvg".
  eq(filterByTags(trades, ['Fair Value Gap']).length, 2, 'selection is normalised')
  eq(filterByTags(trades, ['nothing-uses-this']).length, 0, 'unknown tag matches nothing')

  // The combination that earns the feature: FVG trades where the stop moved.
  eq(filterByTags(trades, ['fvg', 'moved-stop'], 'all').length, 1, 'concept and mistake together')
}

// ── used tags ──────────────────────────────────────────────────────────────
{
  const used = usedTags([t(1, ['fvg']), t(1, ['fvg']), t(1, ['bos']), t(1, [])])
  eq(used.length, 2, 'only tags in use')
  eq(used[0].slug, 'fvg', 'most used first')
  eq(used[0].count, 2, 'counted')
  eq(usedTags([]).length, 0, 'nothing from nothing')
  eq(usedTags([{ pnl: 1 }]).length, 0, 'a trade with no tags array is fine')
}

// ── performance ────────────────────────────────────────────────────────────
{
  const trades = [
    t(300, ['fvg']),
    t(-100, ['fvg']),
    t(-200, ['fvg', 'moved-stop']),
    t(500, ['order-block']),
    t(50, ['fvg'], { status: 'open' }),   // floating — must not count
  ]
  const rows = tagPerformance(trades)
  const fvg = rows.find((r) => r.slug === 'fvg')

  eq(fvg.trades, 3, 'open trades are excluded')
  near(fvg.pnl, 0, 'net across the tag')
  eq(fvg.wins, 1, 'one winner')
  eq(fvg.losses, 2, 'two losers')
  near(fvg.winRate, 100 / 3, 'win rate')
  near(fvg.profitFactor, 1, '300 won against 300 lost')
  near(fvg.best, 300, 'best')
  near(fvg.worst, -200, 'worst')

  // A trade with two tags counts once toward each. The rows therefore do not
  // sum to the account total, and that is correct rather than a bug.
  const moved = rows.find((r) => r.slug === 'moved-stop')
  near(moved.pnl, -200, 'the shared trade counts fully toward the second tag too')
  const rowTotal = rows.reduce((s, r) => s + r.pnl, 0)
  near(rowTotal, 300, 'rows overlap by design: 0 + -200 + 500')

  // Sorted by P&L so the best and worst are at the ends.
  eq(rows[0].slug, 'order-block', 'best tag first')
  eq(rows[rows.length - 1].slug, 'moved-stop', 'worst tag last')

  // No losers at all is genuinely infinite, not a large number.
  const perfect = tagPerformance([t(100, ['x']), t(50, ['x'])])
  eq(perfect[0].profitFactor, Infinity, 'a tag that has never lost')

  // The small-sample guard.
  eq(tagPerformance(trades, { minTrades: 2 }).some((r) => r.slug === 'order-block'), false,
    'a one-trade tag is filtered out')
  eq(tagPerformance(trades, { minTrades: 2 }).some((r) => r.slug === 'fvg'), true,
    'a three-trade tag survives')

  eq(tagPerformance([]).length, 0, 'no trades, no rows')
  eq(byCategory(rows, 'mistake').map((r) => r.slug), ['moved-stop'], 'split by category')
  eq(byCategory(rows, 'concept').length, 2, 'concepts')

  // Fees are part of the result here as everywhere else.
  const withFees = tagPerformance([{ pnl: 100, fees: 130, tags: ['x'] }])
  near(withFees[0].pnl, -30, 'fees turn a winner into a loser')
  eq(withFees[0].losses, 1, 'and it is counted as a loss')
}

// ── mistake cost ───────────────────────────────────────────────────────────
{
  const trades = [
    t(500, ['fvg']),
    t(-200, ['moved-stop']),
    t(-300, ['revenge-trade', 'oversized', 'fomo']),  // three mistakes, ONE trade
    t(100, ['order-block']),
  ]
  const m = mistakeCost(trades)

  eq(m.trades, 2, 'a trade with three mistakes is one trade')
  near(m.pnl, -500, 'and is charged once, not three times')
  eq(m.losses, 2, 'both lost')
  near(m.lostAmount, 500, 'total lost on them')
  near(m.share, 50, 'half of all closed trades carry a mistake')
  // 100 total across everything; without the mistake trades, 600.
  near(m.withoutThem, 600, 'what the account looks like without them')

  // A mistake tag on a winning trade still counts as a mistake — getting away
  // with it is not the same as not doing it.
  const luckyTrades = [t(400, ['revenge-trade']), t(100, ['fvg'])]
  const lucky = mistakeCost(luckyTrades)
  eq(lucky.trades, 1, 'a profitable mistake is still a mistake')
  near(lucky.pnl, 400, 'with its profit reported honestly')
  eq(lucky.losses, 0, 'and no loss')
  near(lucky.withoutThem, 100, 'the account without it is smaller, and says so')

  const clean = mistakeCost([t(100, ['fvg'])])
  eq(clean.trades, 0, 'a clean account has no mistake trades')
  near(clean.share, 0, 'and a zero share')
  near(clean.withoutThem, 100, 'unchanged')

  const empty = mistakeCost([])
  eq(empty.trades, 0, 'empty is empty')
  near(empty.share, 0, 'with no division by zero')

  // Custom tags are not mistakes, however ominously they are named.
  eq(mistakeCost([t(-100, ['my-own-mistake-tag'])]).trades, 0,
    'only catalogued mistakes count as mistakes')
}

console.log(`tags: ${checks} assertions passed`)
