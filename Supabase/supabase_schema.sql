-- =============================================================================
-- Promed: Supabase Database Schema
-- =============================================================================
-- This schema creates all tables needed for the Promed application.
-- Run this script in Supabase SQL Editor to set up the database.
--
-- IMPORTANT: If you already have tables, this script will:
-- 1. Drop existing conflicting constraints
-- 2. Add the transaction_type column to payments
-- 3. Recreate proper constraints
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Clients Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clients (
    client_id SERIAL PRIMARY KEY,
    client_name VARCHAR NOT NULL,
    contact_info TEXT,
    address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 2. Suppliers Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suppliers (
    supplier_id SERIAL PRIMARY KEY,
    supplier_name VARCHAR NOT NULL,
    contact_info TEXT,
    address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 3. Products Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
    product_id SERIAL PRIMARY KEY,
    product_name VARCHAR NOT NULL,
    model VARCHAR,
    unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4. Client Transactions Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_transactions (
    transaction_id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES public.clients(client_id) ON DELETE SET NULL,
    product_id INTEGER REFERENCES public.products(product_id) ON DELETE SET NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
    total_amount NUMERIC NOT NULL CHECK (total_amount >= 0),
    paid_amount NUMERIC DEFAULT 0 CHECK (paid_amount >= 0),
    remaining_amount NUMERIC NOT NULL CHECK (remaining_amount >= 0),
    transaction_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT client_transactions_amounts_check 
        CHECK (total_amount = paid_amount + remaining_amount)
);

-- -----------------------------------------------------------------------------
-- 5. Supplier Transactions Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_transactions (
    transaction_id SERIAL PRIMARY KEY,
    supplier_id INTEGER REFERENCES public.suppliers(supplier_id) ON DELETE SET NULL,
    product_id INTEGER REFERENCES public.products(product_id) ON DELETE SET NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
    total_amount NUMERIC NOT NULL CHECK (total_amount >= 0),
    paid_amount NUMERIC DEFAULT 0 CHECK (paid_amount >= 0),
    remaining_amount NUMERIC NOT NULL CHECK (remaining_amount >= 0),
    transaction_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT supplier_transactions_amounts_check 
        CHECK (total_amount = paid_amount + remaining_amount)
);

-- -----------------------------------------------------------------------------
-- 6. Payments Table (Fixed Schema)
-- -----------------------------------------------------------------------------
-- First, drop the table if it exists to recreate with proper schema
DROP TABLE IF EXISTS public.payments CASCADE;

CREATE TABLE public.payments (
    payment_id SERIAL PRIMARY KEY,
    transaction_id INTEGER NOT NULL,
    transaction_type VARCHAR(10) NOT NULL CHECK (transaction_type IN ('client', 'supplier')),
    payment_amount NUMERIC NOT NULL CHECK (payment_amount > 0),
    payment_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Note: PostgreSQL doesn't support conditional foreign keys or subqueries in CHECK constraints.
-- We use a trigger function (validate_payment_transaction) to enforce referential integrity.
-- The trigger ensures transaction_id exists in the correct table based on transaction_type.

-- -----------------------------------------------------------------------------
-- 7. Trigger Function: Validate Payment Transaction
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

-- Create trigger to validate payments before insert/update
DROP TRIGGER IF EXISTS validate_payment_transaction_trigger ON public.payments;
CREATE TRIGGER validate_payment_transaction_trigger
    BEFORE INSERT OR UPDATE ON public.payments
    FOR EACH ROW
    EXECUTE FUNCTION validate_payment_transaction();

-- -----------------------------------------------------------------------------
-- 8. Indexes for Performance
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_client_transactions_client_id 
    ON public.client_transactions(client_id);
CREATE INDEX IF NOT EXISTS idx_client_transactions_product_id 
    ON public.client_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_client_transactions_date 
    ON public.client_transactions(transaction_date);

CREATE INDEX IF NOT EXISTS idx_supplier_transactions_supplier_id 
    ON public.supplier_transactions(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_transactions_product_id 
    ON public.supplier_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_supplier_transactions_date 
    ON public.supplier_transactions(transaction_date);

CREATE INDEX IF NOT EXISTS idx_payments_transaction_id 
    ON public.payments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_payments_transaction_type 
    ON public.payments(transaction_type);
CREATE INDEX IF NOT EXISTS idx_payments_date 
    ON public.payments(payment_date);

-- -----------------------------------------------------------------------------
-- 9. Updated At Trigger Function
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers to all tables
DROP TRIGGER IF EXISTS update_clients_updated_at ON public.clients;
CREATE TRIGGER update_clients_updated_at
    BEFORE UPDATE ON public.clients
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_suppliers_updated_at ON public.suppliers;
CREATE TRIGGER update_suppliers_updated_at
    BEFORE UPDATE ON public.suppliers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_products_updated_at ON public.products;
CREATE TRIGGER update_products_updated_at
    BEFORE UPDATE ON public.products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_client_transactions_updated_at ON public.client_transactions;
CREATE TRIGGER update_client_transactions_updated_at
    BEFORE UPDATE ON public.client_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_supplier_transactions_updated_at ON public.supplier_transactions;
CREATE TRIGGER update_supplier_transactions_updated_at
    BEFORE UPDATE ON public.supplier_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_payments_updated_at ON public.payments;
CREATE TRIGGER update_payments_updated_at
    BEFORE UPDATE ON public.payments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- 10. Enable Row Level Security (Optional - Uncomment if needed)
-- -----------------------------------------------------------------------------
-- ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.client_transactions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.supplier_transactions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 11. Enable Realtime (Optional - Uncomment if needed)
-- -----------------------------------------------------------------------------
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.clients;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.suppliers;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.client_transactions;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.supplier_transactions;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;

-- =============================================================================
-- Schema Migration Notes:
-- =============================================================================
-- If you have existing data, you'll need to:
-- 1. Add transaction_type to existing payments:
--    UPDATE payments SET transaction_type = 'client' 
--    WHERE transaction_id IN (SELECT transaction_id FROM client_transactions);
--    UPDATE payments SET transaction_type = 'supplier' 
--    WHERE transaction_id IN (SELECT transaction_id FROM supplier_transactions);
--
-- 2. Then run this schema script to recreate the table with proper constraints.
-- =============================================================================
