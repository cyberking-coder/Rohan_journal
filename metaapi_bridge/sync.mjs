#!/usr/bin/env node
// MetaApi.cloud → Supabase sync worker.
//
// Runs on a schedule (GitHub Actions cron by default). For every row in
// `broker_connections`:
//   1. Ensures the MetaApi account is deployed.
//   2. Reads closed deals since `last_deal_at` (or LOOKBACK_DAYS on first run).
//   3. Upserts them into `public.trades`, keyed on (user_id, external_id) —
//      the same unique index the on-prem `mt5_bridge/` uses, so a user can
//      mix and match without duplicates.
//   4. Updates `broker_accounts.last_synced_at` / `last_sync_error` and the
//      connection's `last_deal_at`.
//
// Deliberately conservative: floating positions are NOT written (only closed
// deals become `trades` rows), matching the on-prem bridge's contract that
// every stat in the app is computed from closed trades only.

import { createClient } from '@supabase/supabase-js'

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  METAAPI_TOKEN,
  METAAPI_ENCRYPTION_KEY,
  METAAPI_PROVISIONING_URL = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai',
  METAAPI_CLIENT_URL = 'https://mt-client-api-v1.new-york.agiliumtrade.ai',
  LOOKBACK_DAYS = '30',
} = process.env

const missing = [
  ['SUPABASE_URL', SUPABASE_URL],
  ['SUPABASE_SERVICE_KEY', SUPABASE_SERVICE_KEY],
  ['METAAPI_TOKEN', METAAPI_TOKEN],
  ['METAAPI_ENCRYPTION_KEY', METAAPI_ENCRYPTION_KEY],
].filter(([, v]) => !v).map(([k]) => k)
if (missing.length) {
  console.error(`missing env vars: ${missing.join(', ')}`)
  process.exit(1)
}

const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const encKey = await importAesKey(METAAPI_ENCRYPTION_KEY)

const { data: connections, error: connErr } = await svc
  .from('broker_connections')
  .select('*')
  .in('status', ['provisioning', 'deploying', 'connected', 'error'])

if (connErr) { console.error('load connections:', connErr.message); process.exit(1) }

console.log(`Loaded ${connections.length} connection(s).`)

let ok = 0, failed = 0
for (const c of connections) {
  try {
    await syncConnection(c)
    ok++
  } catch (e) {
    failed++
    console.error(`[${c.id}] ${e?.message ?? e}`)
    await svc.from('broker_connections').update({
      status: 'error',
      last_error: String(e?.message ?? e).slice(0, 500),
    }).eq('id', c.id)
    if (c.broker_account_id) {
      await svc.from('broker_accounts').update({
        last_sync_error: String(e?.message ?? e).slice(0, 500),
      }).eq('id', c.broker_account_id)
    }
  }
}
console.log(`Done. ok=${ok} failed=${failed}`)

async function syncConnection(c) {
  const metaId = c.meta_api_account_id
  if (!metaId) throw new Error('connection has no meta_api_account_id')

  // 1. Ensure deployed. Provisioning API is idempotent; deploy() a running
  //    account is a no-op.
  const acct = await metaFetch(`${METAAPI_PROVISIONING_URL}/users/current/accounts/${metaId}`)
  if (acct.state !== 'DEPLOYED') {
    await metaFetch(`${METAAPI_PROVISIONING_URL}/users/current/accounts/${metaId}/deploy`, { method: 'POST' })
    await svc.from('broker_connections').update({ status: 'deploying' }).eq('id', c.id)
    console.log(`[${c.id}] deploying (state=${acct.state}); trades will land on the next run`)
    return
  }
  if (acct.connectionStatus !== 'CONNECTED') {
    await svc.from('broker_connections').update({ status: 'deploying' }).eq('id', c.id)
    console.log(`[${c.id}] deployed but connection=${acct.connectionStatus}; retrying next run`)
    return
  }

  // 2. Read history since last_deal_at (fallback LOOKBACK_DAYS).
  const sinceMs = c.last_deal_at
    ? new Date(c.last_deal_at).getTime()
    : Date.now() - Number(LOOKBACK_DAYS) * 86400_000
  const startISO = new Date(sinceMs).toISOString()
  const endISO = new Date().toISOString()

  const deals = await metaFetch(
    `${METAAPI_CLIENT_URL}/users/current/accounts/${metaId}/history-deals/time/${encodeURIComponent(startISO)}/${encodeURIComponent(endISO)}`,
  )

  // 3. Group deals by position — each closed position produces one trade row.
  const rows = buildTradeRows(deals, c.user_id, c.broker_account_id, c.mt5_login)
  console.log(`[${c.id}] ${deals.length} deals → ${rows.length} closed trades`)

  if (rows.length) {
    const { error: upErr } = await svc
      .from('trades')
      .upsert(rows, { onConflict: 'user_id,external_id' })
    if (upErr) throw new Error(`trades upsert: ${upErr.message}`)
  }

  // 4. Update sync markers.
  const latestClose = rows.reduce((max, r) => Math.max(max, new Date(r.traded_at).getTime()), sinceMs)
  await svc.from('broker_connections').update({
    status: 'connected',
    last_error: null,
    last_synced_at: new Date().toISOString(),
    last_deal_at: new Date(latestClose).toISOString(),
  }).eq('id', c.id)

  if (c.broker_account_id) {
    await svc.from('broker_accounts').update({
      last_synced_at: new Date().toISOString(),
      last_sync_error: null,
    }).eq('id', c.broker_account_id)
  }
}

// ---------------------------------------------------------------------------
// Deal → trade row
// ---------------------------------------------------------------------------
//
// MetaApi returns MT5 deals: type=DEAL_TYPE_BUY/SELL, entryType=DEAL_ENTRY_IN
// for openings and DEAL_ENTRY_OUT (or OUT_BY) for closings. A closed position
// is [IN deal, ..., OUT deal] sharing the same positionId. We only keep
// positions with both an IN and an OUT.

export function buildTradeRows(deals, userId, brokerAccountId, mt5Login) {
  const byPos = new Map()
  for (const d of deals || []) {
    const pid = d.positionId
    if (!pid) continue
    if (!byPos.has(pid)) byPos.set(pid, [])
    byPos.get(pid).push(d)
  }

  const rows = []
  for (const [pid, ds] of byPos.entries()) {
    ds.sort((a, b) => new Date(a.time) - new Date(b.time))
    const inn = ds.find((d) => d.entryType === 'DEAL_ENTRY_IN')
    const out = [...ds].reverse().find((d) => d.entryType === 'DEAL_ENTRY_OUT' || d.entryType === 'DEAL_ENTRY_OUT_BY')
    if (!inn || !out) continue

    const side = inn.type === 'DEAL_TYPE_BUY' ? 'Long' : 'Short'
    const gross = ds.reduce((s, d) => s + (Number(d.profit) || 0), 0)
    const commission = ds.reduce((s, d) => s + (Number(d.commission) || 0), 0)
    const swap = ds.reduce((s, d) => s + (Number(d.swap) || 0), 0)
    // The journal stores commission as a positive number in `fees`; MT5
    // reports it as a negative on losing sides, so flip the sign.
    const fees = Math.abs(commission)

    rows.push({
      user_id: userId,
      broker_account_id: brokerAccountId ?? null,
      external_id: `${mt5Login}:${pid}`,
      source: 'metaapi',
      symbol: inn.symbol,
      side,
      entry: Number(inn.price) || null,
      exit: Number(out.price) || null,
      qty: Number(inn.volume) || null,
      pnl: gross,
      fees,
      swap,
      traded_at: new Date(out.time).toISOString(),
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// HTTP + crypto helpers
// ---------------------------------------------------------------------------

async function metaFetch(url, init = {}) {
  const resp = await fetch(url, {
    ...init,
    headers: { 'auth-token': METAAPI_TOKEN, 'content-type': 'application/json', ...(init.headers || {}) },
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`metaapi ${resp.status} ${resp.statusText} at ${url} :: ${text.slice(0, 300)}`)
  }
  const ct = resp.headers.get('content-type') || ''
  return ct.includes('application/json') ? resp.json() : resp.text()
}

async function importAesKey(b64) {
  const raw = Buffer.from(b64, 'base64')
  if (raw.length !== 32) throw new Error('METAAPI_ENCRYPTION_KEY must be a base64-encoded 32-byte AES-256 key')
  return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
