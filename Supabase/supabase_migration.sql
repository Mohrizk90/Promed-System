-- =============================================================================
-- Promed: Database Migration Script
-- =============================================================================
-- Use this script to migrate an existing database to the new schema.
-- This script adds the transaction_type column to payments and updates existing data.
--
-- IMPORTANT: Backup your database before running this migration!
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Step 1: Add transaction_type column to payments (if it doesn't exist)
-- -----------------------------------------------------------------------------
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'transaction_type'
    ) THEN
        ALTER TABLE public.payments 
        ADD COLUMN transaction_type VARCHAR(10);
        
        -- Set transaction_type for existing payments based on which table has the transaction_id
        UPDATE public.payments p
        SET transaction_type = 'client'
        WHERE EXISTS (
            SELECT 1 FROM public.client_transactions ct 
            WHERE ct.transaction_id = p.transaction_id
        );
        
        UPDATE public.payments p
        SET transaction_type = 'supplier'
        WHERE EXISTS (
            SELECT 1 FROM public.supplier_transactions st 
            WHERE st.transaction_id = p.transaction_id
        )
        AND transaction_type IS NULL;
        
        -- Make transaction_type NOT NULL after populating
        ALTER TABLE public.payments 
        ALTER COLUMN transaction_type SET NOT NULL;
        
        -- Add check constraint
        ALTER TABLE public.payments 
        ADD CONSTRAINT payments_transaction_type_check 
        CHECK (transaction_type IN ('client', 'supplier'));
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Step 2: Drop conflicting foreign key constraints (if they exist)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    -- Drop the foreign key constraint to supplier_transactions if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'payments_transaction_id_fkey1' 
        AND table_name = 'payments'
    ) THEN
        ALTER TABLE public.payments 
        DROP CONSTRAINT payments_transaction_id_fkey1;
    END IF;
    
    -- Optionally, also drop the client_transactions foreign key if you want to use triggers instead
    -- Uncomment the following if you want to remove it:
    -- IF EXISTS (
    --     SELECT 1 FROM information_schema.table_constraints 
    --     WHERE constraint_name = 'payments_transaction_id_fkey' 
    --     AND table_name = 'payments'
    -- ) THEN
    --     ALTER TABLE public.payments 
    --     DROP CONSTRAINT payments_transaction_id_fkey;
    -- END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Step 3: Create trigger function for payment validation (if it doesn't exist)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_payment_transaction()
RETURNS TRIGGER AS $$
BEGIN
    -- We only enforce that the transaction exists in the matching table.
    -- It is OK if the same numeric ID also exists in the other table,
    -- because payments are disambiguated by transaction_type.
    IF NEW.transaction_type = 'client' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.client_transactions 
            WHERE transaction_id = NEW.transaction_id
        ) THEN
            RAISE EXCEPTION 'Transaction ID % does not exist in client_transactions', NEW.transaction_id;
        END IF;
    ELSIF NEW.transaction_type = 'supplier' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.supplier_transactions 
            WHERE transaction_id = NEW.transaction_id
        ) THEN
            RAISE EXCEPTION 'Transaction ID % does not exist in supplier_transactions', NEW.transaction_id;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Step 4: Create or replace trigger
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS validate_payment_transaction_trigger ON public.payments;
CREATE TRIGGER validate_payment_transaction_trigger
    BEFORE INSERT OR UPDATE ON public.payments
    FOR EACH ROW
    EXECUTE FUNCTION validate_payment_transaction();

-- -----------------------------------------------------------------------------
-- Step 5: Add index on transaction_type for better query performance
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_payments_transaction_type 
    ON public.payments(transaction_type);

-- -----------------------------------------------------------------------------
-- Verification: Check for any payments without transaction_type
-- -----------------------------------------------------------------------------
-- Run this query to verify migration:
-- SELECT COUNT(*) as payments_without_type 
-- FROM public.payments 
-- WHERE transaction_type IS NULL;
-- 
-- This should return 0. If it returns a number > 0, you may need to manually update those records.

-- =============================================================================
-- Migration Complete!
-- =============================================================================
-- After running this migration:
-- 1. Update your frontend code to include transaction_type when inserting payments
-- 2. Update payment queries to filter by transaction_type
-- 3. Test adding payments for both clients and suppliers
-- =============================================================================
