import {
  availableCurrencies, countdown, currencyMeta, dayKey, filterEvents,
  groupByDay, isImminent, nextUpcoming, parseReleaseValue, startOfDay, surprise,
} from '../src/lib/economicEvents.js'

let fails = 0
const eq = (label, got, want, tol = 1e-9) => {
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) <= tol
    : JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(44)} got ${JSON.stringify(got)}${ok ? '' : `  want ${JSON.stringify(want)}`}`)
}

// Wednesday 12 Aug 2026, 12:00 UTC.
const NOW = Date.parse('2026-08-12T12:00:00Z')
const at = (iso) => Date.parse(iso)

const mk = (over = {}) => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  event_at: '2026-08-12T14:00:00Z', currency: 'USD', title: 'CPI YoY',
  impact: 'high', actual: null, forecast: '3.2%', previous: '3.0%',
  source: 'test', ...over,
})

console.log('— day boundaries are computed in the user timezone —')
// 12 Aug 23:00 UTC is already the 13th in Tokyo (+09:00) and still the 12th in
// New York (-04:00). Getting this wrong makes "Today" show the wrong day.
eq('UTC day', dayKey(at('2026-08-12T23:00:00Z'), 'UTC'), '2026-08-12')
eq('Tokyo rolls over', dayKey(at('2026-08-12T23:00:00Z'), 'Asia/Tokyo'), '2026-08-13')
eq('New York has not', dayKey(at('2026-08-12T23:00:00Z'), 'America/New_York'), '2026-08-12')
// 02:00 UTC is still the previous day in New York.
eq('Early UTC is previous day in NY', dayKey(at('2026-08-12T02:00:00Z'), 'America/New_York'), '2026-08-11')
eq('Invalid zone falls back', dayKey(at('2026-08-12T12:00:00Z'), 'Not/AZone'), '2026-08-12')

// Local midnight is a different instant in each zone.
eq('Midnight UTC', new Date(startOfDay(NOW, 'UTC')).toISOString(), '2026-08-12T00:00:00.000Z')
eq('Midnight Tokyo (+9)', new Date(startOfDay(NOW, 'Asia/Tokyo')).toISOString(), '2026-08-11T15:00:00.000Z')
eq('Midnight Kolkata (+5:30)', new Date(startOfDay(NOW, 'Asia/Kolkata')).toISOString(), '2026-08-11T18:30:00.000Z')
eq('Tomorrow is 24h later', startOfDay(NOW, 'UTC', 1) - startOfDay(NOW, 'UTC', 0), 86400000)

console.log('— day tabs —')
const events = [
  mk({ id: 'past', event_at: '2026-08-12T06:00:00Z', title: 'Retail Sales' }),
  mk({ id: 'soon', event_at: '2026-08-12T14:00:00Z' }),
  mk({ id: 'tomorrow', event_at: '2026-08-13T09:00:00Z', currency: 'EUR', impact: 'medium' }),
  mk({ id: 'nextweek', event_at: '2026-08-20T09:00:00Z', currency: 'GBP', impact: 'low' }),
]
const ids = (list) => list.map((e) => e.id)
eq('Upcoming drops past events', ids(filterEvents(events, { tab: 'upcoming', now: NOW })), ['soon', 'tomorrow', 'nextweek'])
eq('Today includes past ones', ids(filterEvents(events, { tab: 'today', now: NOW })), ['past', 'soon'])
eq('Tomorrow', ids(filterEvents(events, { tab: 'tomorrow', now: NOW })), ['tomorrow'])
eq('This week excludes next week', ids(filterEvents(events, { tab: 'week', now: NOW })), ['past', 'soon', 'tomorrow'])
eq('All keeps everything', filterEvents(events, { tab: 'all', now: NOW }).length, 4)
// Results are always chronological regardless of input order.
eq('Sorted by time', ids(filterEvents([...events].reverse(), { tab: 'all', now: NOW })),
  ['past', 'soon', 'tomorrow', 'nextweek'])

console.log('— the timezone changes which day an event lands in —')
const lateEvent = [mk({ id: 'late', event_at: '2026-08-12T23:30:00Z' })]
eq('Late UTC event is today in UTC', ids(filterEvents(lateEvent, { tab: 'today', timezone: 'UTC', now: NOW })), ['late'])
eq('…and tomorrow in Tokyo', ids(filterEvents(lateEvent, { tab: 'tomorrow', timezone: 'Asia/Tokyo', now: NOW })), ['late'])

console.log('— impact, country and search filters —')
eq('High only', ids(filterEvents(events, { tab: 'all', impacts: ['high'], now: NOW })), ['past', 'soon'])
eq('High or medium', filterEvents(events, { tab: 'all', impacts: ['high', 'medium'], now: NOW }).length, 3)
eq('Empty impacts means all', filterEvents(events, { tab: 'all', impacts: [], now: NOW }).length, 4)
eq('By currency', ids(filterEvents(events, { tab: 'all', currency: 'EUR', now: NOW })), ['tomorrow'])
eq('Search by title', ids(filterEvents(events, { tab: 'all', query: 'retail', now: NOW })), ['past'])
eq('Search is case-insensitive', filterEvents(events, { tab: 'all', query: 'CPI', now: NOW }).length, 3)
eq('No match', filterEvents(events, { tab: 'all', query: 'zzz', now: NOW }).length, 0)
eq('Filters combine', ids(filterEvents(events, { tab: 'all', impacts: ['medium'], currency: 'EUR', now: NOW })), ['tomorrow'])
// A malformed timestamp must be dropped, not crash the page.
eq('Bad timestamp dropped', filterEvents([mk({ event_at: 'nope' })], { tab: 'all', now: NOW }).length, 0)

console.log('— grouping and next-up —')
const grouped = groupByDay(filterEvents(events, { tab: 'all', now: NOW }), 'UTC')
eq('Three day groups', grouped.map((g) => g.key), ['2026-08-12', '2026-08-13', '2026-08-20'])
eq('First group has two events', grouped[0].events.length, 2)
eq('Next up is the soonest future event', nextUpcoming(events, NOW).id, 'soon')
// A list of only past events has no "next up" to highlight.
eq('No next up when all past', nextUpcoming([mk({ event_at: '2026-08-01T00:00:00Z' })], NOW), null)
eq('Currencies listed and sorted', availableCurrencies(events), ['EUR', 'GBP', 'USD'])

console.log('— countdown —')
eq('Minutes', countdown(mk({ event_at: '2026-08-12T12:45:00Z' }), NOW), '45m left')
eq('Hours', countdown(mk({ event_at: '2026-08-12T19:00:00Z' }), NOW), '7h left')
eq('Days', countdown(mk({ event_at: '2026-08-15T12:00:00Z' }), NOW), 'in 3d')
eq('Under a minute', countdown(mk({ event_at: '2026-08-12T12:00:30Z' }), NOW), 'in <1m')
// Past its time but no figure published yet — still pending, not stale.
eq('Past with no actual is due now', countdown(mk({ event_at: '2026-08-12T11:00:00Z' }), NOW), 'due now')
eq('Past with an actual is released', countdown(mk({ event_at: '2026-08-12T11:00:00Z', actual: '3.1%' }), NOW), 'released')
eq('Bad timestamp is null', countdown(mk({ event_at: 'nope' }), NOW), null)
eq('Imminent within the hour', isImminent(mk({ event_at: '2026-08-12T12:30:00Z' }), NOW), true)
eq('Not imminent hours out', isImminent(mk({ event_at: '2026-08-12T18:00:00Z' }), NOW), false)
eq('Past is not imminent', isImminent(mk({ event_at: '2026-08-12T11:00:00Z' }), NOW), false)

console.log('— release values keep their units —')
eq('Percent', parseReleaseValue('3.2%'), { value: 3.2, unit: '%' })
eq('Thousands', parseReleaseValue('250K'), { value: 250000, unit: 'K' })
eq('Negative', parseReleaseValue('-0.1%'), { value: -0.1, unit: '%' })
eq('Thousands separator', parseReleaseValue('1,250'), { value: 1250, unit: '' })
eq('Empty is null', parseReleaseValue(''), null)
eq('Missing is null', parseReleaseValue(null), null)
eq('Non-numeric is null', parseReleaseValue('n/a'), null)

console.log('— surprise —')
eq('Beat', surprise(mk({ actual: '3.4%', forecast: '3.2%' })).key, 'above')
eq('Miss', surprise(mk({ actual: '3.0%', forecast: '3.2%' })).key, 'below')
eq('In line', surprise(mk({ actual: '3.2%', forecast: '3.2%' })).key, 'met')
eq('No actual yet', surprise(mk({ actual: null })), null)
eq('No forecast', surprise(mk({ actual: '3.2%', forecast: null })), null)
// Comparing 250K against 3.2% would produce a confident, meaningless verdict.
eq('Mismatched units refuse to compare', surprise(mk({ actual: '250K', forecast: '3.2%' })), null)

console.log('— currency metadata —')
eq('Known currency', currencyMeta('USD').country, 'United States')
eq('Lowercase accepted', currencyMeta('usd').flag, '🇺🇸')
eq('Unknown falls back', currencyMeta('ZZZ').country, 'ZZZ')
eq('Missing is safe', currencyMeta(undefined).country, 'Unknown')

console.log(fails ? `\n${fails} FAILED` : '\nAll assertions passed.')
process.exit(fails ? 1 : 0)
