// Client for the MetaApi.cloud connection flow.
//
// The browser never sees the MetaApi token or the AES key. Every mutation
// goes through a Supabase Edge Function (broker-connect, broker-disconnect);
// reads use the security-definer function list_broker_connections() which is
// already scoped to auth.uid().

import { supabase, isSupabaseConfigured } from './supabase.js'

const CONNECT_FN = 'broker-connect'
const DISCONNECT_FN = 'broker-disconnect'

export async function listMetaApiConnections() {
  if (!isSupabaseConfigured) return { data: [], error: null }
  const { data, error } = await supabase.rpc('list_broker_connections')
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []).filter((r) => r.provider === 'metaapi'), error: null }
}

export async function connectMetaApi({ label, login, password, server, platform = 'mt5', broker = '' }) {
  if (!isSupabaseConfigured) return { data: null, error: 'Supabase is not configured' }
  const { data, error } = await supabase.functions.invoke(CONNECT_FN, {
    body: { label, login, password, server, platform, broker },
  })
  if (error) return { data: null, error: pickError(error, data) }
  if (data?.error) return { data: null, error: data.error }
  return { data, error: null }
}

export async function disconnectMetaApi(connectionId) {
  if (!isSupabaseConfigured) return { error: 'Supabase is not configured' }
  const { data, error } = await supabase.functions.invoke(DISCONNECT_FN, {
    body: { connection_id: connectionId },
  })
  if (error) return { error: pickError(error, data) }
  if (data?.error) return { error: data.error }
  return { error: null }
}

function pickError(err, data) {
  return data?.error || err?.message || 'Something went wrong'
}
