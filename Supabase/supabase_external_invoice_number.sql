-- ============================================================
-- External invoice number (customer-facing) vs internal invoice_number
-- Run this in your Supabase SQL editor
-- ============================================================

ALTER TABLE client_transactions
  ADD COLUMN IF NOT EXISTS external_invoice_number VARCHAR(50);

ALTER TABLE supplier_transactions
  ADD COLUMN IF NOT EXISTS external_invoice_number VARCHAR(50);
