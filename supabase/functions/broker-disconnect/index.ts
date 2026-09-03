// broker-disconnect — remove a MetaApi.cloud account and its stored creds.
//
// Deleting the connection here also removes the MetaApi account so the user
// stops being billed for it. The associated broker_accounts row is left
// alone so historical trades keep their attribution.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const METAAPI_URL = Deno.env.get('METAAPI_URL') ?? 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai'
const METAAPI_TOKEN = Deno.env.get('METAAPI_TOKEN')!
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

    const body = await req.json().catch(() => null)
    const connectionId = String(body?.connection_id ?? '')
    if (!connectionId) return json({ error: 'connection_id required' }, 400)

    const { data: row, error: fetchErr } = await svc
      .from('broker_connections')
      .select('id, user_id, meta_api_account_id')
      .eq('id', connectionId)
      .single()
    if (fetchErr || !row) return json({ error: 'connection not found' }, 404)
    if (row.user_id !== userId) return json({ error: 'forbidden' }, 403)

    if (row.meta_api_account_id) {
      // Best-effort delete on MetaApi; a 404 there is fine (already gone).
      await fetch(`${METAAPI_URL}/users/current/accounts/${row.meta_api_account_id}`, {
        method: 'DELETE',
        headers: { 'auth-token': METAAPI_TOKEN },
      }).catch(() => {})
    }

    const { error: delErr } = await svc.from('broker_connections').delete().eq('id', connectionId)
    if (delErr) return json({ error: delErr.message }, 500)

    return json({ ok: true })
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
