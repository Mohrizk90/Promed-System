import { createClient } from '@supabase/supabase-js'

function requireEnv(name, fallback) {
  const v = process.env[name] || fallback
  if (!v) throw new Error(`Missing server environment variable: ${name}`)
  return v
}

export function getSupabaseUrl() {
  return requireEnv('SUPABASE_URL', process.env.VITE_SUPABASE_URL)
}

export function getSupabaseAnonKey() {
  return requireEnv('SUPABASE_ANON_KEY', process.env.VITE_SUPABASE_ANON_KEY)
}

export function getSupabaseServiceRoleKey() {
  return requireEnv('SUPABASE_SERVICE_ROLE_KEY')
}

export function createServiceClient() {
  return createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function createUserClient(accessToken) {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}
