-- Add ETA code name (registered item name) alongside item code.
-- Run in the Supabase SQL editor after supabase_invoice_eta_codes.sql.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS eta_item_name text;

ALTER TABLE public.client_transactions
  ADD COLUMN IF NOT EXISTS eta_item_name text;

COMMENT ON COLUMN public.products.eta_item_name IS 'ETA registered code name, e.g. Repair Medical Devices';
COMMENT ON COLUMN public.client_transactions.eta_item_name IS 'ETA code name for the primary invoice line';
