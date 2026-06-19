-- Phase 3 invoicing: VAT (14%) and withholding tax (WHT) on client invoices.
-- Run in the Supabase SQL editor.
--
-- total_amount on client_transactions becomes the NET payable:
--   total_amount = subtotal_amount + vat_amount - wht_amount

ALTER TABLE public.client_transactions
  ADD COLUMN IF NOT EXISTS subtotal_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_rate numeric NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS vat_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wht_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wht_amount numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.client_transactions.subtotal_amount IS 'Sum of invoice line items before tax';
COMMENT ON COLUMN public.client_transactions.vat_rate IS 'VAT percentage applied (default 14)';
COMMENT ON COLUMN public.client_transactions.vat_amount IS 'VAT value added on top of subtotal';
COMMENT ON COLUMN public.client_transactions.wht_rate IS 'Withholding tax percentage (0, 1, or 3)';
COMMENT ON COLUMN public.client_transactions.wht_amount IS 'Withholding tax value deducted from the net payable';
