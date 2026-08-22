// Privacy — export and deletion.
//
// The failure mode this suite is built around is silence. An export that
// quietly omits a table looks identical to one where that table was empty, and
// the user only discovers the difference when they need the data and it isn't
// there. So most of these assertions are about completeness being checkable
// rather than about formatting.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DELETIONS, EXPORT_VERSION, USER_TABLES, buildExport, confirms,
  exportFilename, missingSections, summarise,
} from '../src/lib/privacy.js'

let checks = 0
function ok(c, m) { assert.ok(c, m); checks++ }
function eq(a, b, m) { assert.deepEqual(a, b, m); checks++ }

// ── the table list is the contract ─────────────────────────────────────────
{
  const names = USER_TABLES.map((t) => t.table)
  eq(names.length, new Set(names).size, 'no table listed twice')
  ok(USER_TABLES.every((t) => t.key), 'every table says how it is keyed to a user')
  ok(USER_TABLES.every((t) => t.label), 'and carries a human label for the UI')

  // The keys are not uniform, and getting one wrong means an export that
  // silently returns nothing for that table.
  eq(USER_TABLES.find((t) => t.table === 'shared_dashboards').key, 'owner_user_id',
    'share links are keyed by owner_user_id, not user_id')
  eq(USER_TABLES.find((t) => t.table === 'profiles').key, 'id',
    'profiles are keyed by id')

  // Every table the migrations create with a user column must be listed here,
  // or it is neither exported nor deleted. Checked against the SQL itself
  // rather than against a second hand-written list, which would drift.
  const sql = ['schema', 'phase4', 'phase5', 'phase6', 'phase7', 'phase8', 'phase9', 'funded']
    .map((f) => readFileSync(new URL(`../supabase/${f}.sql`, import.meta.url), 'utf8'))
    .join('\n')

  const created = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1])
  const userScoped = created.filter((name) => {
    // The table's own definition, up to the closing paren of the create.
    const at = sql.indexOf(`create table if not exists public.${name}`)
    const body = sql.slice(at, sql.indexOf('\n);', at))
    return /user_id|owner_user_id/.test(body) || name === 'profiles'
  })

  for (const name of userScoped) {
    ok(USER_TABLES.some((t) => t.table === name),
      `${name} holds user data and must be listed in USER_TABLES`)
  }
  ok(userScoped.length >= 6, `the check actually found tables to verify (${userScoped.length})`)
}

// ── deletion specs ─────────────────────────────────────────────────────────
{
  for (const [key, spec] of Object.entries(DELETIONS)) {
    ok(spec.label, `${key}: has a label`)
    ok(spec.warning && spec.warning.length > 40, `${key}: the warning actually explains the scope`)
    ok(spec.confirmWord, `${key}: requires a typed confirmation`)
    ok(Array.isArray(spec.tables), `${key}: names the tables it touches`)
    // Every table named must be one we know how to key.
    for (const t of spec.tables) {
      ok(USER_TABLES.some((u) => u.table === t), `${key}: ${t} is a known table`)
    }
  }

  // The account deletion must cover everything, or "delete my account" is a lie.
  eq([...DELETIONS.account.tables].sort(), USER_TABLES.map((t) => t.table).sort(),
    'deleting the account covers every table holding user data')
  eq(DELETIONS.account.terminal, true, 'and is marked terminal')

  // Deleting the journal must NOT delete trades — it blanks columns.
  eq(DELETIONS.journal.tables, [], 'the journal deletion drops no rows')
  ok(DELETIONS.journal.columns.trades, 'it blanks columns on trades instead')
  eq(DELETIONS.journal.columns.trades.tags, [], 'including tags, which are journal content')
  eq(DELETIONS.journal.columns.trades.pnl, undefined, 'and never touches the P&L')

  // Each confirmation phrase must be distinct, or a user who meant to clear
  // their trades could confirm an account deletion by muscle memory.
  const words = Object.values(DELETIONS).map((d) => d.confirmWord)
  eq(words.length, new Set(words).size, 'every confirmation phrase is distinct')
}

// ── confirmation ───────────────────────────────────────────────────────────
{
  eq(confirms('DELETE MY ACCOUNT', 'account'), true, 'exact phrase')
  eq(confirms('  delete my account  ', 'account'), true, 'case and whitespace tolerant')
  eq(confirms('DELETE MY ACCOUNTS', 'account'), false, 'close is not enough')
  eq(confirms('DELETE TRADES', 'account'), false, 'another action’s phrase does not work')
  eq(confirms('yes', 'account'), false, 'a casual yes does not')
  eq(confirms('', 'account'), false, 'nor an empty one')
  eq(confirms('DELETE MY ACCOUNT', 'nonsense'), false, 'unknown action confirms nothing')
  eq(confirms(null, 'account'), false, 'null confirms nothing')
}

// ── the export document ────────────────────────────────────────────────────
{
  const sections = {
    trades: [{ id: 1 }, { id: 2 }],
    broker_accounts: [],
    profiles: { theme: 'dark' },
  }
  const doc = buildExport({
    email: 'someone@example.com', userId: 'u1', sections,
    warnings: ['Candle data: not included.'],
    now: Date.UTC(2026, 7, 22, 10, 0),
  })

  eq(doc.version, EXPORT_VERSION, 'versioned, so a later importer knows the shape')
  eq(doc.format, 'forex-greek-journal-export', 'and identifies itself')
  eq(doc.exportedAt, '2026-08-22T10:00:00.000Z', 'stamped')
  eq(doc.account.email, 'someone@example.com', 'says whose it is')
  eq(doc.data.trades.length, 2, 'carries the data')

  // The counts index: a reader can see what is in the file without counting.
  eq(doc.contents.trades, 2, 'counted')
  eq(doc.contents.broker_accounts, 0, 'an empty table is counted as zero, not omitted')
  eq(doc.contents.profiles, 1, 'a single-row section counts as one')

  // The warnings travel WITH the file. Shown once in the UI they would be
  // forgotten; the file is what outlives the session.
  eq(doc.warnings.length, 1, 'warnings are part of the document')
  ok(doc.warnings[0].includes('not included'), 'and say what is missing')

  const anon = buildExport({ sections: {}, now: 0 })
  eq(anon.account.email, null, 'an export without an email is still valid')
  eq(anon.data, {}, 'and carries an empty data set rather than throwing')
}

// ── completeness checking ──────────────────────────────────────────────────
{
  const complete = Object.fromEntries(USER_TABLES.map((t) => [t.table, []]))
  eq(missingSections(complete), [], 'a complete set reports nothing missing')

  const partial = { ...complete }
  delete partial.candles
  delete partial.funded_accounts
  eq(missingSections(partial).sort(), ['candles', 'funded_accounts'], 'gaps are named')

  eq(missingSections({}).length, USER_TABLES.length, 'nothing present means everything missing')
  eq(missingSections(null).length, USER_TABLES.length, 'null is handled')

  // The distinction the whole module turns on: an empty table is present,
  // an unqueried table is missing, and they must not look the same.
  ok(!missingSections({ ...complete, trades: [] }).includes('trades'),
    'a table with no rows is present, not missing')
}

// ── summary for the UI ─────────────────────────────────────────────────────
{
  const rows = summarise({ trades: [{}, {}, {}], profiles: { a: 1 } })
  eq(rows.length, USER_TABLES.length, 'every table gets a row, present or not')
  eq(rows.find((r) => r.table === 'trades').count, 3, 'counted')
  eq(rows.find((r) => r.table === 'trades').present, true, 'present')
  eq(rows.find((r) => r.table === 'candles').present, false, 'and absence is visible')
  eq(rows.find((r) => r.table === 'candles').count, 0, 'with a zero count')
  ok(rows.every((r) => r.label), 'each row is labelled for a human')
}

// ── filenames ──────────────────────────────────────────────────────────────
{
  eq(exportFilename('someone@example.com', Date.UTC(2026, 7, 22)), 'someone-export-2026-08-22.json',
    'named after the user and the day')
  eq(exportFilename('a.b+tag@x.com', Date.UTC(2026, 0, 5)), 'a-b-tag-export-2026-01-05.json',
    'awkward addresses are made safe for a filesystem')
  eq(exportFilename(null, Date.UTC(2026, 7, 22)), 'journal-export-2026-08-22.json',
    'and there is always a name')
  ok(!/[/\\:*?"<>|]/.test(exportFilename('a/b:c@x.com')), 'no characters a filesystem rejects')
}

console.log(`privacy: ${checks} assertions passed`)
