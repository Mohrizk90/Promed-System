-- Add 'in_progress' to status enum for existing databases
-- Run this migration if client_transactions/supplier_transactions already have the status column

-- 1. client_transactions
ALTER TABLE public.client_transactions
  DROP CONSTRAINT IF EXISTS client_transactions_status_check;

ALTER TABLE public.client_transactions
  ADD CONSTRAINT client_transactions_status_check
  CHECK (status IN ('not_started', 'in_progress', 'invoice', 'paused', 'paid', 'done'));

-- 2. supplier_transactions
ALTER TABLE public.supplier_transactions
  DROP CONSTRAINT IF EXISTS supplier_transactions_status_check;

ALTER TABLE public.supplier_transactions
  ADD CONSTRAINT supplier_transactions_status_check
  CHECK (status IN ('not_started', 'in_progress', 'invoice', 'paused', 'paid', 'done'));
