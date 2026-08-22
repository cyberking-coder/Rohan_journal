import {
  ALL_ACCOUNTS, SYNC_FRESH_MS, SYNC_STALE_MS, combineAccounts, displayName,
  filterByAccount, fmtRelative, maskIdentifier, platformLabel, syncStatus,
  validateAccount,
} from '../src/lib/brokerAccounts.js'

let fails = 0
const eq = (label, got, want, tol = 1e-9) => {
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) <= tol
    : JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(40)} got ${JSON.stringify(got)}${ok ? '' : `  want ${JSON.stringify(want)}`}`)
}

const NOW = Date.parse('2026-08-12T12:00:00Z')
const ago = (ms) => new Date(NOW - ms).toISOString()

const mkTrade = (over = {}) => ({
  id: Math.random().toString(36).slice(2), symbol: 'XAUUSD', side: 'Long',
  pnl: 10, fees: 0, status: 'closed', source: 'manual', broker_account_id: null,
  traded_at: '2026-08-11T12:00:00Z', closed_at: '2026-08-11T12:00:00Z',
  ...over,
})

const mkAccount = (over = {}) => ({
  id: 'acc-1', label: 'FundingPips', platform: 'mt5', account_number: '20555917',
  is_active: true, is_favorite: false, last_synced_at: ago(60_000), last_sync_error: null,
  ...over,
})

console.log('— sync status —')
eq('Recent sync is connected', syncStatus(mkAccount(), NOW).key, 'connected')
eq('Just inside fresh window', syncStatus(mkAccount({ last_synced_at: ago(SYNC_FRESH_MS - 1000) }), NOW).key, 'connected')
eq('Past fresh window is idle', syncStatus(mkAccount({ last_synced_at: ago(SYNC_FRESH_MS + 1000) }), NOW).key, 'idle')
eq('Past a day is stale', syncStatus(mkAccount({ last_synced_at: ago(SYNC_STALE_MS + 1000) }), NOW).key, 'stale')
eq('Never synced', syncStatus(mkAccount({ last_synced_at: null }), NOW).key, 'never')
// A reported failure must win over a recent-looking timestamp, or a broken
// bridge shows as healthy.
eq('Error beats a fresh timestamp', syncStatus(mkAccount({ last_sync_error: 'login failed' }), NOW).key, 'error')
eq('Error text is surfaced', syncStatus(mkAccount({ last_sync_error: 'login failed' }), NOW).detail, 'login failed')
eq('Disconnected', syncStatus(mkAccount({ is_active: false }), NOW).key, 'disconnected')
eq('Manual platform never looks stale', syncStatus(mkAccount({ platform: 'manual', last_synced_at: null }), NOW).key, 'manual')
eq('Derived accounts have no sync state', syncStatus({ derived: true }, NOW).key, 'derived')
eq('Missing account is safe', syncStatus(null, NOW).key, 'unknown')
eq('Garbage timestamp is safe', syncStatus(mkAccount({ last_synced_at: 'nope' }), NOW).key, 'unknown')

console.log('— relative time —')
eq('Never', fmtRelative(null, NOW), 'never')
eq('Seconds', fmtRelative(ago(30_000), NOW), 'just now')
eq('Minutes', fmtRelative(ago(5 * 60_000), NOW), '5m ago')
eq('Hours', fmtRelative(ago(3 * 3600_000), NOW), '3h ago')
eq('Days', fmtRelative(ago(50 * 3600_000), NOW), '2d ago')

console.log('— combining registered and derived accounts —')
const registered = [
  mkAccount({ id: 'acc-1', label: 'FundingPips' }),
  mkAccount({ id: 'acc-2', label: 'FortressFX', account_number: '70171178', is_favorite: true }),
]
const trades = [
  mkTrade({ broker_account_id: 'acc-1', pnl: 100, source: 'mt5' }),
  mkTrade({ broker_account_id: 'acc-1', pnl: -40, source: 'mt5' }),
  mkTrade({ broker_account_id: 'acc-2', pnl: 25, source: 'mt5', status: 'open' }),
  // Pre-phase-5 history: no account id, so it groups by source instead.
  mkTrade({ pnl: 15, source: 'manual' }),
  mkTrade({ pnl: -5, source: 'mt5' }),
]
const combined = combineAccounts(registered, trades)
eq('Two registered + two derived', combined.length, 4)
eq('Favourite sorts first', combined[0].label, 'FortressFX')
const acc1 = combined.find((a) => a.id === 'acc-1')
eq('Attributed P&L', acc1.pnl, 60)
eq('Attributed trade count', acc1.trades, 2)
eq('Registered accounts are not derived', acc1.derived, false)
const derivedManual = combined.find((a) => a.id === 'derived:manual')
eq('Derived manual group exists', derivedManual.trades, 1)
eq('Derived group is flagged', derivedManual.derived, true)
const derivedMt5 = combined.find((a) => a.id === 'derived:mt5')
eq('Unattributed mt5 trades group separately', derivedMt5.trades, 1)
// Attributed trades must not be double-counted into a derived bucket.
// `trades` counts closed positions only, so the total is closed + open —
// every trade lands in exactly one account and exactly one of the two buckets.
eq('No double counting', combined.reduce((s, a) => s + a.trades + a.open, 0), trades.length)
eq('Open positions tracked', combined.find((a) => a.id === 'acc-2').open, 1)
eq('Win rate', acc1.winRate, 50)
eq('No accounts registered still groups everything', combineAccounts([], trades).length, 2)
eq('No trades leaves accounts with zeroes', combineAccounts(registered, [])[0].trades, 0)

console.log('— filtering —')
eq('All accounts', filterByAccount(trades, ALL_ACCOUNTS).length, 5)
eq('By registered id', filterByAccount(trades, 'acc-1').length, 2)
eq('By derived source', filterByAccount(trades, 'derived:manual').length, 1)
// The derived mt5 bucket must exclude trades already attributed to acc-1/2.
eq('Derived mt5 excludes attributed', filterByAccount(trades, 'derived:mt5').length, 1)
eq('Unknown id matches nothing', filterByAccount(trades, 'acc-nope').length, 0)

console.log('— privacy —')
eq('Masks all but last four', maskIdentifier('20555917'), '••••5917')
eq('Short values fully masked', maskIdentifier('123'), '•••')
eq('Number hidden by default', displayName(mkAccount(), false), 'FundingPips · ••••5917')
eq('Number revealed on request', displayName(mkAccount(), true), 'FundingPips · 20555917')
eq('No number, no separator', displayName(mkAccount({ account_number: null }), false), 'FundingPips')

console.log('— validation —')
eq('Name is required', validateAccount({ label: '  ' }).valid, false)
eq('Valid account', validateAccount({ label: 'Live', platform: 'mt5', account_number: '12345' }).valid, true)
eq('Unknown platform rejected', validateAccount({ label: 'Live', platform: 'wat' }).valid, false)
// Catching a pasted password here is worth the strictness.
eq('Rejects a pasted secret', validateAccount({ label: 'Live', account_number: 'hunter2!@#$' }).valid, false)
eq('Number is optional', validateAccount({ label: 'Live', account_number: '' }).valid, true)
eq('Platform label', platformLabel('mt5'), 'MetaTrader 5')


console.log('\n— open positions are kept apart from realised results —')
// Floating P&L hasn't landed and can still reverse. Folding it into the
// account total overstates what the account has made; counting a merely-green
// position as a win inflates the win rate on top of that.
const withOpen = combineAccounts(
  [{ id: 'acct', label: 'Live', balance: 5000, equity: 5200, leverage: 100, state_at: '2026-08-12T10:00:00Z' }],
  [
    { broker_account_id: 'acct', pnl: 100, status: 'closed', traded_at: '2026-08-12T09:00:00Z' },
    { broker_account_id: 'acct', pnl: -40, status: 'closed', traded_at: '2026-08-12T09:30:00Z' },
    { broker_account_id: 'acct', pnl: 9999, status: 'open', traded_at: '2026-08-12T10:00:00Z' },
  ],
)[0]
eq('realised P&L excludes floating', withOpen.pnl, 60)
eq('floating reported separately', withOpen.floating, 9999)
eq('trade count is closed only', withOpen.trades, 1 + 1)
eq('open counted on its own', withOpen.open, 1)
// 1 win of 2 closed. Counting the green open position would read 66.7%.
eq('win rate ignores open positions', Math.round(withOpen.winRate * 10) / 10, 50)
// Broker-reported state has to survive the merge or the panel can't show it.
eq('balance carried through', withOpen.balance, 5000)
eq('equity carried through', withOpen.equity, 5200)
eq('leverage carried through', withOpen.leverage, 100)

// An account with nothing open must not report a phantom floating figure.
const noneOpen = combineAccounts([{ id: 'b', label: 'B' }],
  [{ broker_account_id: 'b', pnl: 10, status: 'closed', traded_at: '2026-08-12T09:00:00Z' }])[0]
eq('no open positions, no floating', noneOpen.floating, 0)

console.log(fails ? `\n${fails} FAILED` : '\nAll assertions passed.')
process.exit(fails ? 1 : 0)