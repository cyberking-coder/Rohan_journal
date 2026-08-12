import {
  filterJournal, fmtPlannedRatio, isJournaled, journalCompletion,
  journalRating, plannedRatio, tabCounts,
} from '../src/lib/journal.js'
import {
  ALL_ACCOUNTS, accountSummary, buildAccounts, filterByAccount,
  isSynced, maskIdentifier, sourceLabel, tradeSummaryText,
} from '../src/lib/accounts.js'
import { ratingOf } from '../src/lib/stats.js'

let fails = 0
const eq = (label, got, want, tol = 1e-9) => {
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) <= tol
    : JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(36)} got ${JSON.stringify(got)}${ok ? '' : `  want ${JSON.stringify(want)}`}`)
}

const mk = (over = {}) => ({
  id: Math.random().toString(36).slice(2), symbol: 'XAUUSD', side: 'Long',
  pnl: 10, fees: 0, source: 'manual', status: 'closed',
  traded_at: '2026-08-11T12:00:00Z', closed_at: '2026-08-11T12:00:00Z',
  ...over,
})

console.log('— journaled vs pending —')
eq('Blank trade is pending', isJournaled(mk()), false)
eq('Whitespace only is pending', isJournaled(mk({ emotions: '   ' })), false)
eq('One field makes it journaled', isJournaled(mk({ emotions: 'calm' })), true)
eq('A rating alone counts', isJournaled(mk({ journal_rating: 7 })), true)
eq('Null trade is not journaled', isJournaled(null), false)

console.log('— rating scale —')
eq('journal_rating wins', journalRating(mk({ journal_rating: 8, rating: 2 })), 8)
// Rows written before the phase 3 migration only carry the legacy 1-5 value.
eq('Legacy 1-5 doubles to 1-10', journalRating(mk({ rating: 3, journal_rating: null })), 6)
eq('Legacy 5 stars = 10/10', journalRating(mk({ rating: 5, journal_rating: null })), 10)
eq('Unrated is null', journalRating(mk()), null)
eq('stats.ratingOf agrees', ratingOf(mk({ rating: 4, journal_rating: null })), 8)
// A rating of 0 must not be mistaken for "unrated" by a truthiness check.
eq('Rating 0 is not treated as unset', journalRating(mk({ journal_rating: 0 })), 0)

console.log('— completion —')
eq('Empty is 0%', journalCompletion(mk()), 0)
eq('All five parts is 100%', journalCompletion(mk({
  pre_trade_analysis: 'a', post_trade_review: 'b', emotions: 'c',
  lessons_learned: 'd', journal_rating: 7,
})), 100)
eq('Two of five is 40%', journalCompletion(mk({ pre_trade_analysis: 'a', emotions: 'c' })), 40)

console.log('— tab counts —')
const mixed = [mk({ emotions: 'calm' }), mk(), mk({ journal_rating: 5 }), mk()]
eq('All', tabCounts(mixed).all, 4)
eq('Journaled', tabCounts(mixed).journaled, 2)
eq('Pending', tabCounts(mixed).pending, 2)

console.log('— list filtering and sorting —')
const set = [
  mk({ symbol: 'XAUUSD', pnl: 50, closed_at: '2026-08-10T10:00:00Z', emotions: 'calm' }),
  mk({ symbol: 'EURUSD', pnl: -20, closed_at: '2026-08-11T10:00:00Z' }),
  mk({ symbol: 'GBPJPY', pnl: 5, closed_at: '2026-08-12T10:00:00Z', lessons_learned: 'size down' }),
]
eq('Tab: pending', filterJournal(set, { tab: 'pending' }).length, 1)
eq('Tab: journaled', filterJournal(set, { tab: 'journaled' }).length, 2)
eq('Search by symbol', filterJournal(set, { query: 'eur' }).map((t) => t.symbol), ['EURUSD'])
eq('Search matches journal text', filterJournal(set, { query: 'size down' }).map((t) => t.symbol), ['GBPJPY'])
eq('Search is case-insensitive', filterJournal(set, { query: 'CALM' }).map((t) => t.symbol), ['XAUUSD'])
eq('No match returns empty', filterJournal(set, { query: 'zzz' }).length, 0)
eq('Sort recent', filterJournal(set, { sort: 'recent' }).map((t) => t.symbol), ['GBPJPY', 'EURUSD', 'XAUUSD'])
eq('Sort oldest', filterJournal(set, { sort: 'oldest' }).map((t) => t.symbol), ['XAUUSD', 'EURUSD', 'GBPJPY'])
eq('Sort best P&L', filterJournal(set, { sort: 'best' })[0].symbol, 'XAUUSD')
eq('Sort worst P&L', filterJournal(set, { sort: 'worst' })[0].symbol, 'EURUSD')
// Filtering must not reorder or mutate the caller's array.
const original = [...set]
filterJournal(set, { sort: 'best' })
eq('Input array not mutated', set.map((t) => t.symbol), original.map((t) => t.symbol))

console.log('— planned risk:reward —')
eq('1:2', fmtPlannedRatio(1, 2), '1:2')
eq('1:2.5', fmtPlannedRatio(2, 5), '1:2.50')
eq('Ratio value', plannedRatio(1, 3), 3)
eq('Zero risk is null', plannedRatio(0, 2), null)
eq('Empty is a dash', fmtPlannedRatio('', ''), '—')
eq('Negative is a dash', fmtPlannedRatio(-1, 2), '—')

console.log('— accounts —')
const acctTrades = [
  mk({ source: 'manual', pnl: 100 }), mk({ source: 'manual', pnl: -40 }),
  mk({ source: 'mt5', pnl: 25 }), mk({ source: 'mt5', pnl: -5, status: 'open' }),
]
const accts = buildAccounts(acctTrades)
eq('Two accounts found', accts.length, 2)
eq('Manual P&L', accts.find((a) => a.id === 'manual').pnl, 60)
eq('MT5 open positions', accts.find((a) => a.id === 'mt5').open, 1)
eq('Manual win rate', accts.find((a) => a.id === 'manual').winRate, 50)
eq('Manual is not synced', accts.find((a) => a.id === 'manual').synced, false)
eq('MT5 is synced', accts.find((a) => a.id === 'mt5').synced, true)
eq('Filter to one account', filterByAccount(acctTrades, 'mt5').length, 2)
eq('ALL returns everything', filterByAccount(acctTrades, ALL_ACCOUNTS).length, 4)
eq('Summary P&L', accountSummary(acctTrades).pnl, 80)
// "Last activity" must work for a single account and for all accounts at once.
eq('Summary lastAt is set', accountSummary(acctTrades).lastAt != null, true)
eq('Summary lastAt of empty is null', accountSummary([]).lastAt, null)
eq('Source label', sourceLabel('mt5'), 'MetaTrader 5')
// A trade with no source at all is a hand-logged one.
eq('Missing source = manual', isSynced(mk({ source: undefined })), false)
eq('Synced trades are read-only', isSynced(mk({ source: 'FundingPips' })), true)

console.log('— privacy mask —')
eq('Masks all but last four', maskIdentifier('MetaTrader 5'), '••••••••er 5')
eq('Short values fully masked', maskIdentifier('abc'), '•••')
eq('Empty is empty', maskIdentifier(''), '')

console.log('— share summary —')
const summary = tradeSummaryText(mk({ symbol: 'XAUUSD', side: 'Long', pnl: 49.85, entry: 2400, exit: 2410, qty: 0.5 }))
eq('Includes symbol and P&L', /XAUUSD Long — \+\$49\.85/.test(summary), true)
eq('Includes entry and exit', /Entry 2400 → Exit 2410/.test(summary), true)
eq('Loss renders with minus', /-\$20\.00/.test(tradeSummaryText(mk({ pnl: -20 }))), true)

console.log(fails ? `\n${fails} FAILED` : '\nAll assertions passed.')
process.exit(fails ? 1 : 0)
