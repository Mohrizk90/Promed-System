-- Multi-line client invoices: extra rows stored as JSON on the lead transaction.
-- Run in Supabase SQL editor.

ALTER TABLE public.client_transactions
  ADD COLUMN IF NOT EXISTS line_items JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.client_transactions.line_items IS
  'Additional invoice lines [{product_id, product_name, quantity, unit_price, line_total}]';
