import {
  TRADING_SESSIONS, WEEKDAYS, byDayOfWeek, byDirection, bySession, bySymbol,
  calendarMonth, calendarScale, directionOf, sessionOf, winLossDistribution,
} from '../src/lib/analytics.js'

let fails = 0
const eq = (label, got, want, tol = 1e-9) => {
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) <= tol
    : JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} got ${JSON.stringify(got)}${ok ? '' : `  want ${JSON.stringify(want)}`}`)
}

const at = (iso, pnl, over = {}) => ({ traded_at: iso, pnl, symbol: 'EURUSD', ...over })

console.log('— sessions cover all 24h with no gaps and no overlaps —')
// Every hour must land in exactly one session, or trades silently vanish from
// the breakdown (gap) or get counted twice (overlap).
const hours = Array.from({ length: 24 }, (_, h) =>
  TRADING_SESSIONS.filter((s) => (s.start < s.end ? h >= s.start && h < s.end : h >= s.start || h < s.end)).length)
eq('every hour in exactly one session', [...new Set(hours)], [1])

eq('09:00 UTC is London', sessionOf(at('2026-08-12T09:00:00Z', 1)), 'london')
eq('15:00 UTC is New York', sessionOf(at('2026-08-12T15:00:00Z', 1)), 'newyork')
eq('02:00 UTC is Asian', sessionOf(at('2026-08-12T02:00:00Z', 1)), 'asian')
// The Asian session wraps midnight — the classic place to get this wrong.
eq('23:00 UTC wraps into Asian', sessionOf(at('2026-08-12T23:00:00Z', 1)), 'asian')
eq('boundary 08:00 is London not Asian', sessionOf(at('2026-08-12T08:00:00Z', 1)), 'london')
eq('boundary 13:00 is NY not London', sessionOf(at('2026-08-12T13:00:00Z', 1)), 'newyork')
eq('boundary 22:00 is Asian not NY', sessionOf(at('2026-08-12T22:00:00Z', 1)), 'asian')
eq('undated trade has no session', sessionOf({ pnl: 5 }), null)

const sessionTrades = [
  at('2026-08-12T09:00:00Z', 100), at('2026-08-12T10:00:00Z', -40),
  at('2026-08-12T15:00:00Z', 60), at('2026-08-12T02:00:00Z', -10),
]
const sess = bySession(sessionTrades)
eq('london count', sess.find((s) => s.id === 'london').count, 2)
eq('london pnl', sess.find((s) => s.id === 'london').pnl, 60)
eq('london win rate', sess.find((s) => s.id === 'london').winRate, 50)
eq('every trade is bucketed', sess.reduce((s, x) => s + x.count, 0), sessionTrades.length)

console.log('\n— direction —')
// The schema writes side: 'Long'; the MT5 bridge writes direction: 'buy'.
eq('side Long', directionOf({ side: 'Long' }), 'long')
eq('direction buy', directionOf({ direction: 'buy' }), 'long')
eq('direction sell', directionOf({ direction: 'sell' }), 'short')
eq('case insensitive', directionOf({ side: 'SHORT' }), 'short')
eq('missing is null', directionOf({}), null)

const dir = byDirection([
  at('2026-08-12T09:00:00Z', 100, { side: 'Long' }),
  at('2026-08-12T10:00:00Z', -40, { side: 'Long' }),
  at('2026-08-12T11:00:00Z', 60, { direction: 'sell' }),
  at('2026-08-12T12:00:00Z', 5, {}), // no direction at all
])
eq('longs counted', dir[0].count, 2)
eq('shorts counted', dir[1].count, 1)
// A trade with no direction belongs in neither bucket — inventing one would
// misattribute its P&L.
eq('undirected trade excluded', dir[0].count + dir[1].count, 3)
eq('long pnl', dir[0].pnl, 60)

console.log('\n— day of week —')
// 10 Aug 2026 is a Monday.
const dow = byDayOfWeek([
  at('2026-08-10T09:00:00Z', 50), at('2026-08-10T10:00:00Z', 20),
  at('2026-08-14T09:00:00Z', -30), at('2026-08-16T09:00:00Z', 5),
])
eq('starts Monday', dow[0].label, 'Mon')
eq('ends Sunday', dow[6].label, 'Sun')
eq('seven buckets', dow.length, 7)
eq('Monday count', dow[0].count, 2)
eq('Monday pnl', dow[0].pnl, 70)
eq('Friday pnl', dow[4].pnl, -30)
// Sunday is index 6, not 0 — getDay() returns 0 for Sunday and the shift is
// where an off-by-one would put weekend trades on Monday.
eq('Sunday lands last', dow[6].count, 1)
eq('quiet days still present', dow[2].count, 0)

console.log('\n— symbols —')
const syms = bySymbol([
  at('2026-08-12T09:00:00Z', 100, { symbol: 'eurusd' }),
  at('2026-08-12T10:00:00Z', 50, { symbol: 'EURUSD' }),
  at('2026-08-12T11:00:00Z', -200, { symbol: 'GBPJPY' }),
  at('2026-08-12T12:00:00Z', 10, { symbol: null }),
])
eq('case folded into one pair', syms.find((s) => s.symbol === 'EURUSD').count, 2)
eq('sorted by pnl', syms[0].symbol, 'EURUSD')
eq('worst last', syms[syms.length - 1].symbol, 'GBPJPY')
eq('missing symbol labelled', syms.some((s) => s.symbol === 'UNKNOWN'), true)
eq('limit respected', bySymbol(Array.from({ length: 20 }, (_, i) =>
  at('2026-08-12T09:00:00Z', i, { symbol: `S${i}` })), 5).length, 5)

console.log('\n— win/loss distribution —')
const dist = winLossDistribution([
  at('2026-08-12T09:00:00Z', 100), at('2026-08-12T10:00:00Z', -100),
  at('2026-08-12T11:00:00Z', 50), at('2026-08-12T12:00:00Z', -25),
], 8)
eq('bucket count', dist.length, 8)
// Every trade must appear exactly once, or the histogram lies about the sample.
eq('all trades bucketed', dist.reduce((s, b) => s + b.count, 0), 4)
// Symmetric around zero so wins and losses are visually comparable.
eq('half the buckets are negative', dist.filter((b) => !b.positive).length, 4)
// The largest win sits exactly on the top edge; an exclusive bound drops it.
eq('largest win not dropped', dist[dist.length - 1].count >= 1, true)
// The axis label is the lower edge only; eight full ranges don't fit across a
// half-width panel. The full range lives in the tooltip instead.
eq('axis label is one figure', dist[0].label.includes('…'), false)
eq('tooltip keeps the range', dist[0].range.includes(' to '), true)
eq('empty input', winLossDistribution([]), [])
eq('all-zero P&L', winLossDistribution([at('2026-08-12T09:00:00Z', 0)]).length, 1)

console.log('\n— trading calendar —')
// August 2026 starts on a Saturday and has 31 days.
const weeks = calendarMonth([
  at('2026-08-03T09:00:00Z', 120), at('2026-08-03T10:00:00Z', -20),
  at('2026-08-05T09:00:00Z', -60), at('2026-08-31T09:00:00Z', 10),
], 2026, 7)

eq('every week has 7 days', [...new Set(weeks.map((w) => w.days.length))], [7])
eq('weeks start on Monday', weeks[0].days[0].date.getDay(), 1)
eq('no trailing empty week', weeks[weeks.length - 1].days.some((d) => !d.outside), true)
// Padding days keep the grid rectangular but must be visibly not-this-month.
eq('leading padding is flagged', weeks[0].days[0].outside, true)
eq('1 Aug is inside', weeks[0].days.find((d) => d.day === 1 && !d.outside)?.outside, false)

const week2 = weeks.find((w) => w.days.some((d) => !d.outside && d.day === 3))
eq('day totals aggregate', week2.days.find((d) => d.day === 3).pnl, 100)
eq('day trade count', week2.days.find((d) => d.day === 3).count, 2)
eq('weekly rollup', week2.pnl, 40)
eq('rollup counts trades', week2.count, 3)
eq('rollup counts trading days only', week2.tradingDays, 2)

// A week straddling two months must not count the neighbour's days, or the
// same trade appears in two months' rollups.
const sept = calendarMonth([at('2026-08-31T09:00:00Z', 999)], 2026, 8)
eq('straddling week excludes other month', sept[0].pnl, 0)
eq('but still shows the day', sept[0].days.some((d) => d.outside && d.day === 31), true)

eq('scale is the largest absolute day', calendarScale(weeks), 100)
eq('empty month scales to zero', calendarScale(calendarMonth([], 2026, 7)), 0)

console.log(fails ? `\n${fails} FAILED` : '\nAll breakdown assertions passed.')
process.exit(fails ? 1 : 0)
