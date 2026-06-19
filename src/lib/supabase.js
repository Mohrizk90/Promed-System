import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseMissingConfig = !supabaseUrl || !supabaseAnonKey

export const supabase = supabaseMissingConfig
  ? null
  : createClient(supabaseUrl, supabaseAnonKey)
