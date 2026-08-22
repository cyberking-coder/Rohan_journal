// Privacy — Master PRD §83: export, delete trades, delete journal, delete
// account.
//
// These are legal obligations in most of the markets this would be sold in,
// not features. Two consequences follow that make this module unlike the rest
// of the app:
//
//   1. An export must be COMPLETE. A partial export that looks complete is
//      worse than a failure, because the user believes they have their data
//      and stops asking. Every table is enumerated here explicitly, and a
//      table added later that nobody lists here is silently missing — so the
//      list is one constant, and it is asserted against.
//
//   2. A deletion must be IRREVERSIBLE and must say so before it happens.
//      Softening the wording to be less alarming is the wrong instinct: the
//      alarm is the feature.

// Every table holding user data, and how it is keyed to a user.
//
// `owner_user_id` rather than `user_id` on shares is not a quirk worth
// smoothing over — it is what the column is actually called, and guessing
// wrong here means an export that silently returns nothing.
export const USER_TABLES = [
  { table: 'trades', key: 'user_id', label: 'Trades', order: 'traded_at' },
  { table: 'broker_accounts', key: 'user_id', label: 'Broker accounts', order: 'created_at' },
  { table: 'ai_reports', key: 'user_id', label: 'AI reports', order: 'created_at' },
  { table: 'backtest_sessions', key: 'user_id', label: 'Backtest sessions', order: 'created_at' },
  { table: 'funded_accounts', key: 'user_id', label: 'Funded challenges', order: 'created_at' },
  { table: 'shared_dashboards', key: 'owner_user_id', label: 'Share links', order: 'created_at' },
  { table: 'candles', key: 'user_id', label: 'Candle data', order: 't', bulk: true },
  { table: 'profiles', key: 'id', label: 'Preferences', order: null, single: true },
]

// What each destructive action removes. Named so the confirmation dialog and
// the code that does the work read from the same source — a dialog that
// promises less than the code deletes is the worst kind of bug here.
export const DELETIONS = {
  trades: {
    label: 'Delete all trades',
    warning: 'Every trade, including its journal entry, screenshots and tags. Your broker accounts, backtests and preferences stay.',
    tables: ['trades'],
    confirmWord: 'DELETE TRADES',
  },
  journal: {
    label: 'Delete journal entries only',
    warning: 'Clears the written analysis, reviews, lessons, emotions, ratings and tags from every trade. The trades themselves and their P&L are kept.',
    tables: [],
    columns: {
      trades: {
        pre_trade_analysis: null, post_trade_review: null, lessons_learned: null,
        emotions: null, notes: null, journal_rating: null, tags: [],
      },
    },
    confirmWord: 'DELETE JOURNAL',
  },
  backtests: {
    label: 'Delete backtests and candle data',
    warning: 'Every saved replay session and any uploaded candles. Your trades and journal stay.',
    tables: ['backtest_sessions', 'candles'],
    confirmWord: 'DELETE BACKTESTS',
  },
  account: {
    label: 'Delete my account',
    warning: 'Everything: trades, journal, screenshots, broker connections, backtests, challenges, share links and your sign-in. This cannot be undone and support cannot recover it.',
    tables: USER_TABLES.map((t) => t.table),
    confirmWord: 'DELETE MY ACCOUNT',
    terminal: true,
  },
}

/**
 * Is the typed confirmation right?
 *
 * Case-insensitive and whitespace-tolerant, because the point is to make the
 * user stop and read, not to test their typing. A checkbox would not do that;
 * a phrase that has to be reproduced does.
 */
export function confirms(input, action) {
  const want = DELETIONS[action]?.confirmWord
  if (!want) return false
  return String(input || '').trim().toUpperCase() === want.toUpperCase()
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const EXPORT_VERSION = 1

/**
 * Assemble the export document.
 *
 * Kept separate from the fetching so it can be tested without a database, and
 * so the shape is decided in one place. `warnings` is part of the document
 * rather than shown once in the UI: a file that failed to include something
 * must carry that fact with it, since the file is what outlives the session.
 */
export function buildExport({ email, userId, sections, warnings = [], now = Date.now() }) {
  return {
    format: 'forex-greek-journal-export',
    version: EXPORT_VERSION,
    exportedAt: new Date(now).toISOString(),
    account: { id: userId || null, email: email || null },
    // Named up front so a reader can tell at a glance whether the file is
    // complete, without counting arrays.
    contents: Object.fromEntries(
      Object.entries(sections).map(([k, v]) => [k, Array.isArray(v) ? v.length : v ? 1 : 0]),
    ),
    warnings,
    data: sections,
  }
}

/**
 * Are all the tables actually represented?
 *
 * The check exists because the failure mode is silent: a table that was never
 * queried looks identical in the output to a table with no rows.
 */
export function missingSections(sections) {
  return USER_TABLES
    .map((t) => t.table)
    .filter((name) => !(name in (sections || {})))
}

export function exportFilename(email, now = Date.now()) {
  const stamp = new Date(now).toISOString().slice(0, 10)
  const who = String(email || 'journal').split('@')[0].replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  return `${who || 'journal'}-export-${stamp}.json`
}

/**
 * A summary for the UI, so the user knows what they are about to download.
 *
 * "Export my data" with no indication of what is in it is the pattern that
 * makes people click it twice and then email support.
 */
export function summarise(sections) {
  return USER_TABLES.map((t) => {
    const v = sections?.[t.table]
    return {
      table: t.table,
      label: t.label,
      count: Array.isArray(v) ? v.length : v ? 1 : 0,
      present: t.table in (sections || {}),
    }
  })
}
