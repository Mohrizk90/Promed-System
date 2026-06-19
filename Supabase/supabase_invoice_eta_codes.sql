-- ETA (Egyptian Tax Authority) e-invoice item codes.
-- Run in the Supabase SQL editor.
--
-- Products carry their registered ETA item code + default unit type, which
-- auto-fill onto invoice lines (can be overridden per line). The primary
-- invoice line stores its code on client_transactions; additional lines store
-- item_code / unit_type inside the existing line_items JSON array.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS eta_item_code text,
  ADD COLUMN IF NOT EXISTS eta_unit_type text DEFAULT 'EA';

ALTER TABLE public.client_transactions
  ADD COLUMN IF NOT EXISTS eta_item_code text,
  ADD COLUMN IF NOT EXISTS eta_unit_type text DEFAULT 'EA';

COMMENT ON COLUMN public.products.eta_item_code IS 'ETA registered item code, e.g. EG-614087716-1';
COMMENT ON COLUMN public.products.eta_unit_type IS 'ETA unit of measure code, e.g. EA, KGM';
COMMENT ON COLUMN public.client_transactions.eta_item_code IS 'ETA item code for the primary invoice line';
COMMENT ON COLUMN public.client_transactions.eta_unit_type IS 'ETA unit type for the primary invoice line';
