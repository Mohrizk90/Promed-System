-- =============================================================================
-- Promed: Backfill Payments from Existing Transactions
-- =============================================================================
-- This script creates payment records for existing transactions that have
-- paid_amount > 0 but no corresponding payment records in the payments table.
--
-- IMPORTANT: Run this after running the migration script to add transaction_type
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Step 1: Backfill client transactions with paid_amount but no payments
-- --------------------------------------------a---------------------------------
INSERT INTO public.payments (transaction_id, transaction_type, payment_amount, payment_date)
SELECT 
    ct.transaction_id,
    'client'::VARCHAR(10) as transaction_type,
    ct.paid_amount,
    ct.transaction_date
FROM public.client_transactions ct
WHERE ct.paid_amount > 0
  AND NOT EXISTS (
      SELECT 1 
      FROM public.payments p 
      WHERE p.transaction_id = ct.transaction_id 
        AND p.transaction_type = 'client'
  )
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Step 2: Backfill supplier transactions with paid_amount but no payments
-- -----------------------------------------------------------------------------
INSERT INTO public.payments (transaction_id, transaction_type, payment_amount, payment_date)
SELECT 
    st.transaction_id,
    'supplier'::VARCHAR(10) as transaction_type,
    st.paid_amount,
    st.transaction_date
FROM public.supplier_transactions st
WHERE st.paid_amount > 0
  AND NOT EXISTS (
      SELECT 1 
      FROM public.payments p 
      WHERE p.transaction_id = st.transaction_id 
        AND p.transaction_type = 'supplier'
  )
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Step 3: Verify the backfill
-- -----------------------------------------------------------------------------
-- Run these queries to verify the backfill worked:

-- Check client transactions with paid_amount but no payments:
-- SELECT ct.transaction_id, ct.paid_amount, 
--        COALESCE(SUM(p.payment_amount), 0) as total_payments
-- FROM public.client_transactions ct
-- LEFT JOIN public.payments p ON p.transaction_id = ct.transaction_id 
--   AND p.transaction_type = 'client'
-- WHERE ct.paid_amount > 0
-- GROUP BY ct.transaction_id, ct.paid_amount
-- HAVING COALESCE(SUM(p.payment_amount), 0) = 0;

-- Check supplier transactions with paid_amount but no payments:
-- SELECT st.transaction_id, st.paid_amount,
--        COALESCE(SUM(p.payment_amount), 0) as total_payments
-- FROM public.supplier_transactions st
-- LEFT JOIN public.payments p ON p.transaction_id = st.transaction_id 
--   AND p.transaction_type = 'supplier'
-- WHERE st.paid_amount > 0
-- GROUP BY st.transaction_id, st.paid_amount
-- HAVING COALESCE(SUM(p.payment_amount), 0) = 0;

-- =============================================================================
-- Backfill Complete!
-- =============================================================================
-- All existing transactions with paid_amount > 0 now have corresponding
-- payment records in the payments table.
-- =============================================================================
