// Broker account domain logic.
//
// Two kinds of account exist side by side, and both are real:
//
//   • Registered accounts — rows in `broker_accounts`, created by the user or
//     by the sync bridge. These carry a label, platform and sync timestamps.
//   • Derived accounts — inferred from a trade's `source` when it has no
//     `broker_account_id`. Every trade logged before phase 5 is in this group.
//
// The UI shows both so no trade ever goes missing from the switcher, and
// derived ones are marked so the user can see what to formalise.

import { net } from './stats.js'

export const ALL_ACCOUNTS = '__all__'
export const UNATTRIBUTED = '__unattributed__'

export const PLATFORMS = {
  mt5: { label: 'MetaTrader 5', synced: true },
  mt4: { label: 'MetaTrader 4', synced: true },
  manual: { label: 'Manual entry', synced: false },
  other: { label: 'Other', synced: false },
}

export function platformLabel(platform) {
  return PLATFORMS[platform]?.label ?? platform ?? 'Unknown'
}

// ---------------------------------------------------------------------------
// Sync status
// ---------------------------------------------------------------------------

// A bridge polling every 60s is "live"; a few hours quiet usually means the
// terminal is closed, which is normal overnight. A day of silence is worth
// flagging, because it usually means the bridge stopped and the user doesn't
// know their journal is going stale.
export const SYNC_FRESH_MS = 6 * 60 * 60 * 1000
export const SYNC_STALE_MS = 24 * 60 * 60 * 1000

/**
 * @param {object} account
 * @param {number} now  injectable so this is testable without faking the clock
 */
export function syncStatus(account, now = Date.now()) {
  if (!account) return { key: 'unknown', label: 'Unknown', tone: 'muted' }

  if (account.derived) {
    return {
      key: 'derived',
      label: 'Not registered',
      tone: 'muted',
      detail: 'Inferred from the trade source. Register it to track sync status.',
    }
  }
  if (account.is_active === false) {
    return { key: 'disconnected', label: 'Disconnected', tone: 'muted', detail: 'History is kept; nothing new will sync.' }
  }
  if (!PLATFORMS[account.platform]?.synced) {
    return { key: 'manual', label: 'Manual', tone: 'neutral', detail: 'Trades are entered by hand.' }
  }
  if (account.last_sync_error) {
    return { key: 'error', label: 'Sync error', tone: 'bad', detail: account.last_sync_error }
  }
  if (!account.last_synced_at) {
    return { key: 'never', label: 'Never synced', tone: 'neutral', detail: 'Run the bridge to import trades.' }
  }

  const age = now - new Date(account.last_synced_at).getTime()
  if (!Number.isFinite(age)) return { key: 'unknown', label: 'Unknown', tone: 'muted' }
  if (age <= SYNC_FRESH_MS) return { key: 'connected', label: 'Connected', tone: 'good' }
  if (age <= SYNC_STALE_MS) return { key: 'idle', label: 'Idle', tone: 'neutral', detail: 'No sync in a few hours.' }
  return { key: 'stale', label: 'Stale', tone: 'bad', detail: 'No sync in over a day — is the bridge running?' }
}

export function fmtRelative(value, now = Date.now()) {
  if (!value) return 'never'
  const ms = now - new Date(value).getTime()
  if (!Number.isFinite(ms)) return 'never'
  if (ms < 60000) return 'just now'
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ---------------------------------------------------------------------------
// Combining registered and derived accounts
// ---------------------------------------------------------------------------

function blankStats() {
  return { trades: 0, wins: 0, pnl: 0, open: 0, lastAt: null }
}

function addTrade(stats, trade) {
  const p = net(trade)
  stats.trades += 1
  stats.pnl += p
  if (p > 0) stats.wins += 1
  if (trade.status === 'open') stats.open += 1
  const at = new Date(trade.closed_at || trade.traded_at).getTime()
  if (Number.isFinite(at) && (stats.lastAt === null || at > stats.lastAt)) stats.lastAt = at
  return stats
}

function withRates(entry) {
  return { ...entry, winRate: entry.trades ? (entry.wins / entry.trades) * 100 : 0 }
}

/**
 * Registered accounts (with their stats) plus one derived entry per distinct
 * `source` among trades that aren't attributed to a registered account.
 */
export function combineAccounts(registered = [], trades = []) {
  const byId = new Map()
  for (const a of registered) {
    byId.set(a.id, { ...a, derived: false, ...blankStats() })
  }

  const derived = new Map()
  for (const t of trades) {
    const target = t.broker_account_id && byId.get(t.broker_account_id)
    if (target) { addTrade(target, t); continue }

    // Unattributed: group by source so pre-phase-5 history still appears.
    const key = String(t.source ?? 'manual').toLowerCase()
    const entry = derived.get(key) || {
      id: `derived:${key}`,
      label: platformLabel(key) === key ? key : platformLabel(key),
      platform: key === 'manual' ? 'manual' : key === 'mt5' || key === 'mt4' ? key : 'other',
      derived: true,
      is_active: true,
      is_favorite: false,
      last_synced_at: null,
      ...blankStats(),
    }
    addTrade(entry, t)
    derived.set(key, entry)
  }

  const all = [...byId.values(), ...derived.values()].map(withRates)

  // Favourites first, then the accounts actually being traded.
  return all.sort((a, b) => {
    if (!!b.is_favorite !== !!a.is_favorite) return b.is_favorite ? 1 : -1
    return b.trades - a.trades
  })
}

export function filterByAccount(trades, accountId) {
  if (!accountId || accountId === ALL_ACCOUNTS) return trades
  if (accountId.startsWith('derived:')) {
    const source = accountId.slice('derived:'.length)
    return trades.filter((t) => !t.broker_account_id
      && String(t.source ?? 'manual').toLowerCase() === source)
  }
  return trades.filter((t) => t.broker_account_id === accountId)
}

// Masks all but the last four characters, for the privacy eye-toggle.
export function maskIdentifier(value) {
  const s = String(value ?? '')
  if (s.length <= 4) return '•'.repeat(s.length)
  return `${'•'.repeat(Math.max(3, s.length - 4))}${s.slice(-4)}`
}

// What the switcher and Settings show for an account, honouring the privacy
// toggle. The label is user-chosen so it stays readable; the account number is
// the part worth hiding on a shared screen.
export function displayName(account, revealed) {
  if (!account) return ''
  const number = account.account_number
  if (!number) return account.label
  return `${account.label} · ${revealed ? number : maskIdentifier(number)}`
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateAccount({ label, platform, account_number: number }) {
  const errors = {}
  if (!String(label ?? '').trim()) errors.label = 'Give the account a name.'
  if (platform && !PLATFORMS[platform]) errors.platform = 'Unknown platform.'
  // Account numbers are digits at MT4/MT5; catching a pasted password here is
  // worth the small strictness.
  if (number && !/^[A-Za-z0-9-]{1,32}$/.test(String(number).trim())) {
    errors.account_number = 'Use the account number only — letters, digits and dashes.'
  }
  return { valid: Object.keys(errors).length === 0, errors }
}
