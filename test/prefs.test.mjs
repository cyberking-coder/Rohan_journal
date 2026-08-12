import {
  ALL_TIMEZONES, formatMoneyCompact, CURRENCIES, CURRENCY_KEYS, TIMEZONE_GROUPS,
  currencySymbol, formatDateTime, formatMoney, resolveTimezone,
  timezoneCity, timezoneOffsetLabel,
} from '../src/lib/format.js'
import { monthlyTotals, realisedSplit } from '../src/lib/analytics.js'

let fails = 0
const eq = (label, got, want, tol = 1e-9) => {
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) <= tol
    : JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(38)} got ${JSON.stringify(got)}${ok ? '' : `  want ${JSON.stringify(want)}`}`)
}

const mk = (over = {}) => ({
  id: Math.random().toString(36).slice(2), symbol: 'XAUUSD', side: 'Long',
  pnl: 10, fees: 0, status: 'closed', source: 'manual',
  traded_at: '2026-08-11T12:00:00Z', closed_at: '2026-08-11T12:00:00Z',
  ...over,
})

console.log('— currency formatting —')
eq('USD', formatMoney(1234.5, { currency: 'USD' }), '$1,234.50')
eq('EUR symbol', formatMoney(1234.5, { currency: 'EUR' }), '€1,234.50')
eq('GBP symbol', formatMoney(99, { currency: 'GBP' }), '£99.00')
eq('JPY symbol', formatMoney(99, { currency: 'JPY' }), '¥99.00')
eq('Negative keeps sign before symbol', formatMoney(-42, { currency: 'USD' }), '-$42.00')
eq('Zero digits', formatMoney(1234.56, { currency: 'USD', digits: 0 }), '$1,235')
eq('Unknown currency falls back to $', currencySymbol('XYZ'), '$')
eq('Non-numeric is zero', formatMoney('abc', { currency: 'USD' }), '$0.00')
eq('Null is zero', formatMoney(null, { currency: 'USD' }), '$0.00')
// The setting changes the symbol only — it must never scale the number.
eq('Currency does not convert', formatMoney(100, { currency: 'EUR' }).replace('€', ''), formatMoney(100, { currency: 'USD' }).replace('$', ''))
eq('Every currency has a symbol', CURRENCY_KEYS.every((c) => CURRENCIES[c].symbol.length > 0), true)

console.log('— compact money —')
// Rounding a real loss to "-$0" would read as flat when it is not.
eq('Small values keep decimals', formatMoneyCompact(-0.2), '-$0.20')
eq('Large values drop decimals', formatMoneyCompact(1234.56), '$1,235')
eq('Ten and up drops decimals', formatMoneyCompact(10.4), '$10')
eq('Under ten keeps them', formatMoneyCompact(9.9), '$9.90')
eq('Exact zero is plain', formatMoneyCompact(0), '$0')

console.log('— timezones —')
eq('Empty preference resolves to a zone', resolveTimezone('') !== '', true)
eq('Explicit zone is kept', resolveTimezone('Asia/Kolkata'), 'Asia/Kolkata')
eq('City from zone', timezoneCity('Asia/Kolkata'), 'Kolkata')
eq('Underscores become spaces', timezoneCity('America/New_York'), 'New York')
eq('Offset label looks like GMT', /GMT/.test(timezoneOffsetLabel('Asia/Kolkata')), true)
eq('No duplicate zones', new Set(ALL_TIMEZONES).size, ALL_TIMEZONES.length)
eq('Zone list is substantial', ALL_TIMEZONES.length >= 60, true)
eq('Every group has zones', TIMEZONE_GROUPS.every((g) => g.zones.length > 0), true)
// Every listed zone must actually be resolvable, or the picker offers a
// setting that breaks every timestamp.
const badZones = ALL_TIMEZONES.filter((z) => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: z }).format(new Date()); return false }
  catch { return true }
})
eq('All zones are valid IANA names', badZones, [])

console.log('— timestamp rendering —')
const noon = '2026-08-11T12:00:00Z'
eq('Renders in UTC', formatDateTime(noon, { timezone: 'UTC' }).includes('12:00'), true)
// Kolkata is UTC+5:30, so noon UTC is 17:30 local.
eq('Renders in Kolkata', formatDateTime(noon, { timezone: 'Asia/Kolkata' }).includes('5:30'), true)
eq('Invalid date is a dash', formatDateTime('not-a-date', { timezone: 'UTC' }), '—')
// A bad zone must not blank the UI.
eq('Invalid zone still renders', formatDateTime(noon, { timezone: 'Not/AZone' }).length > 0, true)

console.log('— monthly totals —')
const across = [
  mk({ pnl: 100, closed_at: '2026-06-10T12:00:00Z' }),
  mk({ pnl: -40, closed_at: '2026-06-20T12:00:00Z' }),
  mk({ pnl: 25, closed_at: '2026-07-05T12:00:00Z' }),
  mk({ pnl: 5, closed_at: '2026-08-01T12:00:00Z' }),
]
const months = monthlyTotals(across)
eq('Three months', months.length, 3)
eq('Chronological', months.map((m) => m.key), ['2026-06', '2026-07', '2026-08'])
eq('June nets 60', months[0].pnl, 60)
eq('June counts 2 trades', months[0].count, 2)
eq('Empty input is empty', monthlyTotals([]), [])

console.log('— realised vs unrealised —')
const mixed = [
  mk({ pnl: 100 }), mk({ pnl: -40 }),
  mk({ pnl: 30, status: 'open' }),
]
const split = realisedSplit(mixed)
eq('Realised excludes open', split.realised, 60)
eq('Unrealised is only open', split.unrealised, 30)
eq('Open count', split.openCount, 1)
eq('Closed count', split.closedCount, 2)
// With no broker sync there are no open positions, and that must read as a
// genuine zero rather than being conjured from closed trades.
eq('No open trades = zero unrealised', realisedSplit([mk(), mk()]).unrealised, 0)

console.log(fails ? `\n${fails} FAILED` : '\nAll assertions passed.')
process.exit(fails ? 1 : 0)
