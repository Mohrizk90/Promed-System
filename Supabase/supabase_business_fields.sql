-- ============================================================
-- Promed Business Fields Migration
-- Run this in your Supabase SQL editor to add new columns
-- ============================================================

-- 1. Transaction enhancements: invoice number, due date, payment terms
ALTER TABLE client_transactions
  ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(20) DEFAULT 'none';
  -- payment_terms values: 'none', 'cod', 'net_15', 'net_30', 'net_60', 'net_90'

ALTER TABLE supplier_transactions
  ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(20) DEFAULT 'none';

-- 2. Payment method tracking on payments
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS reference_number VARCHAR(100);
  -- payment_method values: 'cash', 'bank_transfer', 'check', 'credit_card', 'other'

ALTER TABLE liability_payments
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS reference_number VARCHAR(100);

-- 3. Optional: auto-calculate due_date from payment_terms via trigger
CREATE OR REPLACE FUNCTION calculate_due_date()
RETURNS TRIGGER AS $$
BEGIN
  -- Only auto-set due_date if not explicitly provided and payment_terms is set
  IF NEW.due_date IS NULL AND NEW.payment_terms IS NOT NULL AND NEW.payment_terms != 'none' THEN
    CASE NEW.payment_terms
      WHEN 'cod' THEN NEW.due_date := NEW.transaction_date;
      WHEN 'net_15' THEN NEW.due_date := NEW.transaction_date + INTERVAL '15 days';
      WHEN 'net_30' THEN NEW.due_date := NEW.transaction_date + INTERVAL '30 days';
      WHEN 'net_60' THEN NEW.due_date := NEW.transaction_date + INTERVAL '60 days';
      WHEN 'net_90' THEN NEW.due_date := NEW.transaction_date + INTERVAL '90 days';
      ELSE NULL;
    END CASE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to both transaction tables
DROP TRIGGER IF EXISTS trg_calc_due_date_client ON client_transactions;
CREATE TRIGGER trg_calc_due_date_client
  BEFORE INSERT OR UPDATE ON client_transactions
  FOR EACH ROW EXECUTE FUNCTION calculate_due_date();

DROP TRIGGER IF EXISTS trg_calc_due_date_supplier ON supplier_transactions;
CREATE TRIGGER trg_calc_due_date_supplier
  BEFORE INSERT OR UPDATE ON supplier_transactions
  FOR EACH ROW EXECUTE FUNCTION calculate_due_date();
