import {
  MIN_TRADES, WEEKLY_QUOTA, canGenerate, formatReset, msUntilReset, quotaState,
  shapeReport, summariseTrades, toneMeta, weekStart, weekStartKey,
} from '../src/lib/aiReport.js'

let fails = 0
const eq = (label, got, want, tol = 1e-9) => {
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) <= tol
    : JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} got ${JSON.stringify(got)}${ok ? '' : `  want ${JSON.stringify(want)}`}`)
}

const DAY = 86400000

console.log('— the week bucket is Monday 00:00 UTC —')
// Wednesday 12 Aug 2026 → Monday 10 Aug 2026.
eq('midweek', weekStartKey(Date.parse('2026-08-12T12:00:00Z')), '2026-08-10')
// The Monday itself is its own week start, at both ends of the day.
eq('Monday 00:00', weekStartKey(Date.parse('2026-08-10T00:00:00Z')), '2026-08-10')
eq('Monday 23:59', weekStartKey(Date.parse('2026-08-10T23:59:59Z')), '2026-08-10')
// Sunday is the *end* of the week, not the start of the next one — getUTCDay
// returns 0 for Sunday, which is the classic off-by-one here.
eq('Sunday belongs to the week before', weekStartKey(Date.parse('2026-08-16T23:00:00Z')), '2026-08-10')
eq('next Monday rolls over', weekStartKey(Date.parse('2026-08-17T00:00:01Z')), '2026-08-17')
// Crossing a month and a year boundary.
eq('across a month', weekStartKey(Date.parse('2026-09-01T09:00:00Z')), '2026-08-31')
eq('across a year', weekStartKey(Date.parse('2027-01-01T09:00:00Z')), '2026-12-28')

console.log('\n— reset countdown —')
const wed = Date.parse('2026-08-12T12:00:00Z')
eq('reset is exactly 7d after week start', weekStart(wed) + 7 * DAY, Date.parse('2026-08-17T00:00:00Z'))
eq('ms until reset', msUntilReset(wed), Date.parse('2026-08-17T00:00:00Z') - wed)
eq('formats days', formatReset(4 * DAY + 12 * 3600000), '4d 12h')
eq('formats hours', formatReset(3 * 3600000 + 25 * 60000), '3h 25m')
eq('formats minutes', formatReset(9 * 60000), '9m')
eq('never negative', formatReset(-5), 'now')

console.log('\n— quota —')
const report = (created, week) => ({ id: created, created_at: created, week_start: week })
const thisWeek = [
  report('2026-08-10T08:00:00Z', '2026-08-10'),
  report('2026-08-12T08:00:00Z', '2026-08-10'),
]
const lastWeek = [report('2026-08-05T08:00:00Z', '2026-08-03')]

eq('counts only this week', quotaState([...thisWeek, ...lastWeek], wed).used, 2)
eq('remaining', quotaState([...thisWeek, ...lastWeek], wed).remaining, WEEKLY_QUOTA - 2)
eq('not exhausted at 2 of 3', quotaState(thisWeek, wed).exhausted, false)
eq('exhausted at the limit', quotaState([...thisWeek, report('2026-08-11T08:00:00Z', '2026-08-10')], wed).exhausted, true)
// Older rows may predate week_start; created_at has to carry them.
eq('falls back to created_at', quotaState([{ id: 'x', created_at: '2026-08-11T08:00:00Z' }], wed).used, 1)
// A stale quota can't go negative and turn into extra credit.
eq('never negative remaining', quotaState(Array.from({ length: 9 }, (_, i) => report(`x${i}`, '2026-08-10')), wed).remaining, 0)
eq('empty archive', quotaState([], wed).used, 0)

console.log('\n— the generate gate —')
const many = Array.from({ length: 20 }, () => ({ traded_at: '2026-08-10T00:00:00Z', pnl: 10 }))
const fresh = quotaState([], wed)
eq('allowed', canGenerate({ trades: many, quota: fresh }).ok, true)
eq('blocked while generating', canGenerate({ trades: many, quota: fresh, generating: true }).ok, false)
eq('blocked below the minimum', canGenerate({ trades: many.slice(0, MIN_TRADES - 1), quota: fresh }).ok, false)
eq('blocked when out of quota', canGenerate({ trades: many, quota: quotaState(Array.from({ length: WEEKLY_QUOTA }, (_, i) => report(`q${i}`, '2026-08-10')), wed) }).ok, false)

console.log('\n— what the model is shown —')
const trades = [
  { traded_at: '2026-08-01T10:00:00Z', symbol: 'eurusd', pnl: 120, direction: 'buy', setup: 'London breakout' },
  { traded_at: '2026-08-02T10:00:00Z', symbol: 'EURUSD', pnl: -40, mistakes: 'moved my stop' },
  { traded_at: '2026-08-03T10:00:00Z', symbol: 'GBPJPY', pnl: -200 },
  { traded_at: '2026-08-04T10:00:00Z', symbol: 'GBPJPY', pnl: 60 },
]
const s = summariseTrades(trades)
eq('counts', s.count, 4)
eq('net', s.netPnl, -60)
eq('win rate', s.winRate, 50)
eq('avg win', s.avgWin, 90)
eq('avg loss', s.avgLoss, -120)
eq('largest loss', s.largestLoss, -200)
// Symbols are normalised so 'eurusd' and 'EURUSD' aren't two different pairs.
eq('symbols are folded', s.symbols.length, 2)
eq('eurusd folded', s.symbols.find((x) => x.symbol === 'EURUSD').trades, 2)
eq('period start', s.periodStart, '2026-08-01T10:00:00.000Z')
eq('period end', s.periodEnd, '2026-08-04T10:00:00.000Z')
eq('nothing truncated', s.truncatedFrom, null)
// Empty note fields become null rather than '' so they cost no tokens.
eq('empty notes dropped', s.trades[2].setup, null)
eq('notes kept', s.trades[0].setup, 'London breakout')

// Trades arrive in whatever order the query returned; the summary must be
// chronological or "period start" would be a lie.
const shuffled = [trades[2], trades[0], trades[3], trades[1]]
eq('order-independent start', summariseTrades(shuffled).periodStart, s.periodStart)

const long = Array.from({ length: 150 }, (_, i) => ({
  traded_at: `2026-0${1 + Math.floor(i / 40)}-${String((i % 27) + 1).padStart(2, '0')}T10:00:00Z`,
  symbol: 'EURUSD', pnl: 1,
}))
const capped = summariseTrades(long, { limit: 120 })
eq('caps the tail', capped.count, 120)
eq('says it truncated', capped.truncatedFrom, 150)
// Long notes are clipped so a few essays can't crowd out the rest.
const wordy = summariseTrades([{ traded_at: '2026-08-01T10:00:00Z', pnl: 1, setup: 'x'.repeat(500) }])
eq('clips long notes', wordy.trades[0].setup.length, 200)

console.log('\n— shaping what comes back —')
const shaped = shapeReport({
  id: 'r1', title: 'GBPJPY is bleeding you', summary: 'One pair is the whole loss.',
  sections: [
    { heading: 'The good', body: 'EURUSD is steady.', tone: 'positive' },
    { heading: 'The bad', body: 'GBPJPY is 1-for-6.', tone: 'critical' },
  ],
  created_at: '2026-08-12T09:00:00Z', trade_count: 41, model: 'claude-opus-5',
})
eq('title', shaped.title, 'GBPJPY is bleeding you')
eq('sections', shaped.sections.length, 2)
eq('tone kept', shaped.sections[1].tone, 'critical')
// A row written before the schema settled, or by hand, still has to render.
eq('json string sections', shapeReport({ id: 'r2', sections: '[{"heading":"H","body":"B"}]' }).sections.length, 1)
eq('garbage sections', shapeReport({ id: 'r3', sections: 'not json' }).sections, [])
eq('null sections', shapeReport({ id: 'r4', sections: null }).sections, [])
eq('missing title', shapeReport({ id: 'r5' }).title, 'Performance review')
eq('unknown tone falls back', shapeReport({ id: 'r6', sections: [{ heading: 'H', body: 'B', tone: 'spicy' }] }).sections[0].tone, 'neutral')
eq('empty sections dropped', shapeReport({ id: 'r7', sections: [{}, { heading: 'H' }] }).sections.length, 1)
eq('null row', shapeReport(null), null)
eq('tone meta', toneMeta('warning').label, 'Watch')
eq('unknown tone meta', toneMeta('nope').label, 'Note')

console.log(fails ? `\n${fails} FAILED` : '\nAll AI report assertions passed.')
process.exit(fails ? 1 : 0)
