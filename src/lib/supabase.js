import { createClient } from '@supabase/supabase-js'

// Supabase configuration – use env vars in production (e.g. Vercel)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://fzbefrisiatshbckxhkq.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6YmVmcmlzaWF0c2hiY2t4aGtxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NTU2NzEsImV4cCI6MjA4NTMzMTY3MX0.Yevs5T4fwnxsyOM8qHm4fcif-u4TFD0i3P1tpj-nvp4'


// For direct PostgreSQL connection (if needed for admin operations)
// const supabasePassword = process.env.VITE_SUPABASE_PASSWORD || 'YOUR-PASSWORD'
// const supabaseDbUrl = `postgresql://postgres:${supabasePassword}@db.fzbefrisiatshbckxhkq.supabase.co:5432/postgres`

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
