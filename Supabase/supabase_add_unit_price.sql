-- =============================================================================
-- Promed: Add unit_price to Transaction Tables
-- =============================================================================
-- Run this script in Supabase SQL Editor to add unit_price column to transactions.
-- Existing rows will be backfilled: unit_price = total_amount / quantity
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Add unit_price to client_transactions
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'client_transactions' AND column_name = 'unit_price'
    ) THEN
        ALTER TABLE public.client_transactions 
        ADD COLUMN unit_price NUMERIC;
        
        -- Backfill: unit_price = total_amount / quantity
        UPDATE public.client_transactions 
        SET unit_price = total_amount / NULLIF(quantity, 0)
        WHERE unit_price IS NULL AND quantity > 0;
        
        -- Make NOT NULL with default for future inserts (existing rows now have values)
        ALTER TABLE public.client_transactions 
        ALTER COLUMN unit_price SET NOT NULL;
        
        ALTER TABLE public.client_transactions 
        ADD CONSTRAINT client_transactions_unit_price_check 
        CHECK (unit_price >= 0);
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Add unit_price to supplier_transactions
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'supplier_transactions' AND column_name = 'unit_price'
    ) THEN
        ALTER TABLE public.supplier_transactions 
        ADD COLUMN unit_price NUMERIC;
        
        -- Backfill: unit_price = total_amount / quantity
        UPDATE public.supplier_transactions 
        SET unit_price = total_amount / NULLIF(quantity, 0)
        WHERE unit_price IS NULL AND quantity > 0;
        
        -- Make NOT NULL
        ALTER TABLE public.supplier_transactions 
        ALTER COLUMN unit_price SET NOT NULL;
        
        ALTER TABLE public.supplier_transactions 
        ADD CONSTRAINT supplier_transactions_unit_price_check 
        CHECK (unit_price >= 0);
    END IF;
END $$;

-- =============================================================================
-- Migration Complete! unit_price is now stored per transaction.
-- =============================================================================
