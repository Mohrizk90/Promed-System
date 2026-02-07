-- Add status column to client_transactions and supplier_transactions
-- Status values: not_started, invoice, paused, paid, done

-- 1. client_transactions
ALTER TABLE public.client_transactions
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'invoice', 'paused', 'paid', 'done'));

-- 2. supplier_transactions
ALTER TABLE public.supplier_transactions
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'invoice', 'paused', 'paid', 'done'));
