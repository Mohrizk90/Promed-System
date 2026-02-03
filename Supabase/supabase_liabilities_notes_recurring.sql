-- Add notes and recurring to liabilities (run after supabase_liabilities.sql)
ALTER TABLE public.liabilities
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS recurring BOOLEAN DEFAULT false;
