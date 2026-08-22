import { supabase, isSupabaseConfigured } from './supabase'

const BUCKET = 'screenshots'

// How long a display link stays valid. Long enough to open a trade, edit it
// and save; short enough that a copied link isn't a permanent back door.
const SIGNED_URL_SECONDS = 60 * 60

/**
 * Uploads a trade screenshot and returns its storage *path*.
 *
 * Deliberately not a public URL. The bucket is private (see
 * `supabase/storage.sql`) because a chart screenshot usually has the terminal
 * in frame — account balance, equity, open positions. A public URL is readable
 * by anyone who has it, forever, with no way to revoke it.
 *
 * In demo mode there is no Supabase, so a temporary object URL keeps the
 * preview working locally.
 */
export async function uploadScreenshot(file, userId) {
  if (!file) return null
  if (!isSupabaseConfigured) return URL.createObjectURL(file)

  const ext = (file.name.split('.').pop() || 'png').toLowerCase()
  // The first path segment is the owner, which is what the storage policies
  // check. A file uploaded outside your own folder is rejected.
  const path = `${userId || 'anon'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'image/png',
  })
  if (error) throw error

  return path
}

/**
 * Turns a stored screenshot value into something an `<img src>` can use.
 *
 * Handles three cases, because rows written at different times hold different
 * things:
 *   • a storage path      → signed for an hour
 *   • a legacy public URL → returned as-is (it will 404 now the bucket is
 *     private, which is the correct outcome: that link was readable by anyone)
 *   • a blob: URL from demo mode → returned as-is
 */
export async function screenshotSrc(value) {
  if (!value) return null
  if (/^(https?:|blob:|data:)/.test(value)) return value
  if (!isSupabaseConfigured) return value

  const { data, error } = await supabase.storage
    .from(BUCKET).createSignedUrl(value, SIGNED_URL_SECONDS)
  if (error) return null
  return data?.signedUrl ?? null
}
