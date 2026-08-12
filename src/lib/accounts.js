// Account grouping for the Trades page.
//
// Real broker accounts arrive in phase 5 (`broker_accounts` + the sync
// bridge). Until then the only account-like signal on a trade is `source`
// — 'manual' for hand-logged trades, a broker name for imported ones — so
// the switcher groups by that. It's genuinely useful today and the shape
// matches what phase 5 will replace it with.

import { net } from './stats.js'

export const ALL_ACCOUNTS = '__all__'

const SOURCE_LABELS = {
  manual: 'Manual entry',
  mt5: 'MetaTrader 5',
  mt4: 'MetaTrader 4',
}

export function sourceLabel(source) {
  const key = String(source ?? 'manual').toLowerCase()
  return SOURCE_LABELS[key] ?? source
}

// Trades imported from a broker are read-only — the spec disables deletion for
// them. Mirrors the `is_deletable` generated column added in phase 0.
export function isSynced(trade) {
  const source = String(trade?.source ?? 'manual').toLowerCase()
  return source !== 'manual'
}

/**
 * One entry per distinct source, plus per-account summary figures for the
 * strip under the switcher.
 */
export function buildAccounts(trades) {
  const map = new Map()
  for (const t of trades) {
    const id = String(t.source ?? 'manual').toLowerCase()
    const cur = map.get(id) || {
      id, label: sourceLabel(id), synced: isSynced(t),
      trades: 0, wins: 0, pnl: 0, open: 0, lastAt: null,
    }
    cur.trades += 1
    cur.pnl += net(t)
    if (net(t) > 0) cur.wins += 1
    if (t.status === 'open') cur.open += 1
    const at = new Date(t.closed_at || t.traded_at).getTime()
    if (Number.isFinite(at) && (cur.lastAt === null || at > cur.lastAt)) cur.lastAt = at
    map.set(id, cur)
  }

  return [...map.values()]
    .map((a) => ({ ...a, winRate: a.trades ? (a.wins / a.trades) * 100 : 0 }))
    .sort((a, b) => b.trades - a.trades)
}

export function accountSummary(trades) {
  const wins = trades.filter((t) => net(t) > 0).length
  const stamps = trades
    .map((t) => new Date(t.closed_at || t.traded_at).getTime())
    .filter(Number.isFinite)
  return {
    trades: trades.length,
    pnl: trades.reduce((s, t) => s + net(t), 0),
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    open: trades.filter((t) => t.status === 'open').length,
    // Most recent activity across whatever scope was passed in, so this works
    // for a single account and for "All accounts" alike.
    lastAt: stamps.length ? Math.max(...stamps) : null,
  }
}

export function filterByAccount(trades, accountId) {
  if (!accountId || accountId === ALL_ACCOUNTS) return trades
  return trades.filter((t) => String(t.source ?? 'manual').toLowerCase() === accountId)
}

// Masks all but the last four characters, for the privacy eye-toggle. Account
// numbers are the sensitive bit once phase 5 lands; applying it to the source
// identifier now keeps the behaviour in place.
export function maskIdentifier(value) {
  const s = String(value ?? '')
  if (s.length <= 4) return '•'.repeat(s.length)
  return `${'•'.repeat(Math.max(3, s.length - 4))}${s.slice(-4)}`
}

// A plain-text summary of a trade, for the share action. Sharing to a public
// URL is the Trader POV feature in phase 9; copying a summary is the part
// that can be built honestly today.
export function tradeSummaryText(trade) {
  const pnl = net(trade)
  const sign = pnl >= 0 ? '+' : '-'
  const money = `${sign}$${Math.abs(pnl).toFixed(2)}`
  const when = new Date(trade.closed_at || trade.traded_at).toLocaleString()
  const lines = [
    `${trade.symbol} ${trade.side} — ${money}`,
    `Entry ${trade.entry ?? '—'} → Exit ${trade.exit ?? '—'} · ${trade.qty ?? '—'} lots`,
    trade.strategy ? `Strategy: ${trade.strategy}` : null,
    `Closed: ${when}`,
  ]
  return lines.filter(Boolean).join('\n')
}
