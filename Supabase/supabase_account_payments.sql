-- =============================================================================
-- Promed: Account-level client payments + allocation to invoices
-- =============================================================================
-- Run after supabase_schema.sql, supabase_business_fields.sql, supabase_sync_transaction_paid.sql
-- Optional (multi-user RLS): supabase_user_id_rls.sql — if not run, allocation policies allow any linked payment.
-- Enables:
--   - Payments received at client account level (may exceed current invoice totals)
--   - FIFO allocation of payments to open invoices
--   - Customer credit balance from unallocated / overpaid amounts
-- =============================================================================

-- 1. Extend payments for account-level receipts
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES public.clients(client_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES public.suppliers(supplier_id) ON DELETE SET NULL;

ALTER TABLE public.payments
  ALTER COLUMN transaction_id DROP NOT NULL;

-- 2. Allocation table: how each payment is applied to invoices
CREATE TABLE IF NOT EXISTS public.payment_allocations (
  allocation_id SERIAL PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES public.payments(payment_id) ON DELETE CASCADE,
  transaction_id INTEGER NOT NULL,
  transaction_type VARCHAR(10) NOT NULL CHECK (transaction_type IN ('client', 'supplier')),
  allocated_amount NUMERIC NOT NULL CHECK (allocated_amount > 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment_id
  ON public.payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_transaction
  ON public.payment_allocations(transaction_id, transaction_type);
CREATE INDEX IF NOT EXISTS idx_payments_client_id
  ON public.payments(client_id) WHERE client_id IS NOT NULL;

-- 3. Validate payment: invoice-linked OR account-level
CREATE OR REPLACE FUNCTION validate_payment_transaction()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.transaction_type = 'client' THEN
    IF NEW.transaction_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.client_transactions WHERE transaction_id = NEW.transaction_id) THEN
        RAISE EXCEPTION 'Transaction ID % does not exist in client_transactions', NEW.transaction_id;
      END IF;
      IF NEW.client_id IS NULL THEN
        SELECT ct.client_id INTO NEW.client_id
        FROM public.client_transactions ct
        WHERE ct.transaction_id = NEW.transaction_id;
      END IF;
    ELSIF NEW.client_id IS NULL THEN
      RAISE EXCEPTION 'Client payment requires client_id when transaction_id is null';
    END IF;
  ELSIF NEW.transaction_type = 'supplier' THEN
    IF NEW.transaction_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.supplier_transactions WHERE transaction_id = NEW.transaction_id) THEN
        RAISE EXCEPTION 'Transaction ID % does not exist in supplier_transactions', NEW.transaction_id;
      END IF;
      IF NEW.supplier_id IS NULL THEN
        SELECT st.supplier_id INTO NEW.supplier_id
        FROM public.supplier_transactions st
        WHERE st.transaction_id = NEW.transaction_id;
      END IF;
    ELSIF NEW.supplier_id IS NULL THEN
      RAISE EXCEPTION 'Supplier payment requires supplier_id when transaction_id is null';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Sync paid/remaining from allocations (fallback to legacy direct payments)
CREATE OR REPLACE FUNCTION sync_one_transaction_paid(tid INTEGER, ttyp VARCHAR(10))
RETURNS void AS $$
DECLARE
    new_paid NUMERIC;
BEGIN
    IF ttyp IS NULL OR tid IS NULL THEN
        RETURN;
    END IF;

    SELECT COALESCE(SUM(pa.allocated_amount), 0) INTO new_paid
    FROM public.payment_allocations pa
    WHERE pa.transaction_id = tid AND pa.transaction_type = ttyp;

    IF new_paid = 0 THEN
        SELECT COALESCE(SUM(p.payment_amount), 0) INTO new_paid
        FROM public.payments p
        WHERE p.transaction_id = tid AND p.transaction_type = ttyp;
    END IF;

    IF ttyp = 'client' THEN
        UPDATE public.client_transactions
        SET paid_amount = new_paid,
            remaining_amount = GREATEST(total_amount - new_paid, 0),
            updated_at = NOW()
        WHERE transaction_id = tid;
    ELSIF ttyp = 'supplier' THEN
        UPDATE public.supplier_transactions
        SET paid_amount = new_paid,
            remaining_amount = GREATEST(total_amount - new_paid, 0),
            updated_at = NOW()
        WHERE transaction_id = tid;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_transaction_paid_from_allocations()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM sync_one_transaction_paid(OLD.transaction_id, OLD.transaction_type);
        RETURN OLD;
    ELSE
        PERFORM sync_one_transaction_paid(NEW.transaction_id, NEW.transaction_type);
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_allocations_paid_trigger ON public.payment_allocations;
CREATE TRIGGER sync_allocations_paid_trigger
    AFTER INSERT OR UPDATE OR DELETE ON public.payment_allocations
    FOR EACH ROW
    EXECUTE FUNCTION sync_transaction_paid_from_allocations();

-- 5. Backfill client_id on existing invoice-linked payments
UPDATE public.payments p
SET client_id = ct.client_id
FROM public.client_transactions ct
WHERE p.transaction_type = 'client'
  AND p.transaction_id = ct.transaction_id
  AND p.client_id IS NULL;

UPDATE public.payments p
SET supplier_id = st.supplier_id
FROM public.supplier_transactions st
WHERE p.transaction_type = 'supplier'
  AND p.transaction_id = st.transaction_id
  AND p.supplier_id IS NULL;

-- 6. Backfill allocations from legacy per-invoice payments
INSERT INTO public.payment_allocations (payment_id, transaction_id, transaction_type, allocated_amount)
SELECT p.payment_id, p.transaction_id, p.transaction_type, p.payment_amount
FROM public.payments p
WHERE p.transaction_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_allocations pa WHERE pa.payment_id = p.payment_id
  );

-- 7. RLS for payment_allocations (works with or without payments.user_id)
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_allocations_select" ON public.payment_allocations;
DROP POLICY IF EXISTS "payment_allocations_insert" ON public.payment_allocations;
DROP POLICY IF EXISTS "payment_allocations_update" ON public.payment_allocations;
DROP POLICY IF EXISTS "payment_allocations_delete" ON public.payment_allocations;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payments'
      AND column_name = 'user_id'
  ) THEN
    CREATE POLICY "payment_allocations_select" ON public.payment_allocations FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.payment_id = payment_allocations.payment_id
          AND (p.user_id IS NULL OR p.user_id = auth.uid())
      )
    );
    CREATE POLICY "payment_allocations_insert" ON public.payment_allocations FOR INSERT WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.payment_id = payment_allocations.payment_id
          AND (p.user_id IS NULL OR p.user_id = auth.uid())
      )
    );
    CREATE POLICY "payment_allocations_update" ON public.payment_allocations FOR UPDATE USING (
      EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.payment_id = payment_allocations.payment_id
          AND (p.user_id IS NULL OR p.user_id = auth.uid())
      )
    );
    CREATE POLICY "payment_allocations_delete" ON public.payment_allocations FOR DELETE USING (
      EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.payment_id = payment_allocations.payment_id
          AND (p.user_id IS NULL OR p.user_id = auth.uid())
      )
    );
  ELSE
    CREATE POLICY "payment_allocations_select" ON public.payment_allocations FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.payment_id = payment_allocations.payment_id
      )
    );
    CREATE POLICY "payment_allocations_insert" ON public.payment_allocations FOR INSERT WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.payment_id = payment_allocations.payment_id
      )
    );
    CREATE POLICY "payment_allocations_update" ON public.payment_allocations FOR UPDATE USING (
      EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.payment_id = payment_allocations.payment_id
      )
    );
    CREATE POLICY "payment_allocations_delete" ON public.payment_allocations FOR DELETE USING (
      EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.payment_id = payment_allocations.payment_id
      )
    );
  END IF;
END $$;
