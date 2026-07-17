import { supabase, isSupabaseConfigured } from './supabase'

const BUCKET = 'screenshots'

// Uploads a trade screenshot and returns a public URL.
// In demo mode (no Supabase) returns a temporary object URL so the preview
// still works locally.
export async function uploadScreenshot(file, userId) {
  if (!file) return null
  if (!isSupabaseConfigured) return URL.createObjectURL(file)

  const ext = (file.name.split('.').pop() || 'png').toLowerCase()
  const path = `${userId || 'anon'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'image/png',
  })
  if (error) throw error

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}
