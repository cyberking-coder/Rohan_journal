// broker-connect — provision a MetaApi.cloud account for the signed-in user.
//
// The MetaApi token and encryption key must never touch the browser. The
// browser sends {label, login, password, server, platform} to this Edge
// Function; we:
//   1. Verify the caller's JWT and resolve their user id.
//   2. Create (or reuse) a broker_accounts row so the UI sees the account.
//   3. Create a MetaApi.cloud account using the shared MetaApi token.
//   4. Encrypt (login,password,server) with AES-GCM using METAAPI_ENCRYPTION_KEY.
//   5. Insert / upsert a broker_connections row keyed on (user, login).
//
// The response tells the client the connection is provisioning. The Node
// sync worker (running every 5 minutes via GitHub Actions) will finish
// deploying it and start pulling trades.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const METAAPI_URL = Deno.env.get('METAAPI_URL') ?? 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai'
const METAAPI_TOKEN = Deno.env.get('METAAPI_TOKEN')!
const METAAPI_REGION = Deno.env.get('METAAPI_REGION') ?? 'new-york'
const ENC_KEY_B64 = Deno.env.get('METAAPI_ENCRYPTION_KEY')!

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'missing bearer token' }, 401)

    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { data: userData, error: userErr } = await svc.auth.getUser(authHeader.slice(7))
    if (userErr || !userData?.user) return json({ error: 'unauthorised' }, 401)
    const userId = userData.user.id

    // Plan gate: Free has no cloud connections; Pro capped at 3; Elite ∞.
    const { data: subRow } = await svc.from('subscriptions')
      .select('plan').eq('user_id', userId).maybeSingle()
    const plan = subRow?.plan ?? 'free'
    const cap = plan === 'elite' ? Infinity : plan === 'pro' ? 3 : 0
    if (cap === 0) {
      return json({ error: 'Cloud auto-sync requires a Pro or Elite plan.' }, 402)
    }
    const { count: existing } = await svc.from('broker_connections')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
    if ((existing ?? 0) >= cap) {
      return json({ error: `Your plan allows up to ${cap} cloud connection${cap === 1 ? '' : 's'}.` }, 402)
    }

    const body = await req.json().catch(() => null)
    if (!body) return json({ error: 'invalid json' }, 400)

    const label = String(body.label ?? '').trim()
    const login = String(body.login ?? '').trim()
    const password = String(body.password ?? '')
    const server = String(body.server ?? '').trim()
    const platform = body.platform === 'mt4' ? 'mt4' : 'mt5'
    const broker = String(body.broker ?? '').trim() || 'Broker'

    if (!login || !password || !server) return json({ error: 'login, password and server are required' }, 400)
    if (!/^\d+$/.test(login)) return json({ error: 'login must be a numeric account id' }, 400)

    // 1. Create MetaApi account (cloud, read-only via investor password).
    const metaResp = await fetch(`${METAAPI_URL}/users/current/accounts`, {
      method: 'POST',
      headers: {
        'auth-token': METAAPI_TOKEN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: label || `${broker} ${login}`,
        type: 'cloud',
        login,
        password,
        server,
        platform,
        magic: 0,
        application: 'MetaApi',
        region: METAAPI_REGION,
      }),
    })

    if (!metaResp.ok) {
      const text = await metaResp.text()
      return json({ error: `metaapi rejected: ${metaResp.status} ${text.slice(0, 300)}` }, 502)
    }
    const meta = await metaResp.json()
    const metaApiAccountId = String(meta.id ?? meta._id ?? '')
    if (!metaApiAccountId) return json({ error: 'metaapi returned no account id' }, 502)

    // 2. Encrypt the credentials.
    const key = await importAesKey(ENC_KEY_B64)
    const nonce = crypto.getRandomValues(new Uint8Array(12))
    const plaintext = new TextEncoder().encode(JSON.stringify({ login, password, server, platform }))
    const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext)
    const ciphertextB64 = b64encode(new Uint8Array(cipherBuf))
    const nonceB64 = b64encode(nonce)

    // 3. Upsert broker_accounts row so the app has something to attach trades to.
    const { data: acctRow, error: acctErr } = await svc
      .from('broker_accounts')
      .upsert({
        user_id: userId,
        label: label || `${broker} ${login}`,
        platform,
        broker,
        login: String(login),
        is_active: true,
      }, { onConflict: 'user_id,platform,login' })
      .select('id')
      .single()
    // If broker_accounts has no such unique constraint, the upsert may fail —
    // fall through with a plain insert.
    let brokerAccountId = acctRow?.id ?? null
    if (acctErr || !brokerAccountId) {
      const { data: inserted, error: insErr } = await svc
        .from('broker_accounts')
        .insert({
          user_id: userId,
          label: label || `${broker} ${login}`,
          platform,
          broker,
          login: String(login),
          is_active: true,
        })
        .select('id')
        .single()
      if (insErr) return json({ error: `broker_accounts insert failed: ${insErr.message}` }, 500)
      brokerAccountId = inserted?.id ?? null
    }

    // 4. Upsert broker_connections row.
    const { error: connErr } = await svc.from('broker_connections').upsert({
      user_id: userId,
      broker_account_id: brokerAccountId,
      provider: 'metaapi',
      meta_api_account_id: metaApiAccountId,
      mt5_login: String(login),
      mt5_server: server,
      platform,
      credentials_ciphertext: ciphertextB64,
      credentials_nonce: nonceB64,
      status: 'provisioning',
      last_error: null,
    }, { onConflict: 'user_id,provider,mt5_login' })

    if (connErr) return json({ error: `broker_connections upsert failed: ${connErr.message}` }, 500)

    return json({ ok: true, meta_api_account_id: metaApiAccountId, broker_account_id: brokerAccountId })
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

async function importAesKey(b64: string) {
  const raw = b64decode(b64)
  if (raw.length !== 32) throw new Error('METAAPI_ENCRYPTION_KEY must be 32 raw bytes, base64-encoded (256-bit AES key)')
  return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

function b64encode(u8: Uint8Array): string {
  let s = ''
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i])
  return btoa(s)
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return u8
}
