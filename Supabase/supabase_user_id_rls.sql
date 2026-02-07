-- =============================================================================
-- Promed: Add user_id and Row Level Security (multi-user support)
-- =============================================================================
-- Run when you need multi-user / per-user data. Adds user_id to all tables
-- and enables RLS so each user only sees their own data.
-- Existing rows get user_id = NULL and remain visible to all until backfilled.
-- =============================================================================

-- Add user_id to all tables (nullable for existing rows)
ALTER TABLE public.clients
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.suppliers
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.client_transactions
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.supplier_transactions
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.liabilities
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.liability_payments
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Enable RLS on all tables
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liability_payments ENABLE ROW LEVEL SECURITY;

-- Policies: allow access when user_id = auth.uid() OR user_id IS NULL (legacy rows)
CREATE POLICY "clients_select" ON public.clients FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "clients_insert" ON public.clients FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "clients_update" ON public.clients FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "clients_delete" ON public.clients FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "suppliers_select" ON public.suppliers FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "suppliers_insert" ON public.suppliers FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "suppliers_update" ON public.suppliers FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "suppliers_delete" ON public.suppliers FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "products_select" ON public.products FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "products_insert" ON public.products FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "products_update" ON public.products FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "products_delete" ON public.products FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "client_transactions_select" ON public.client_transactions FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "client_transactions_insert" ON public.client_transactions FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "client_transactions_update" ON public.client_transactions FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "client_transactions_delete" ON public.client_transactions FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "supplier_transactions_select" ON public.supplier_transactions FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "supplier_transactions_insert" ON public.supplier_transactions FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "supplier_transactions_update" ON public.supplier_transactions FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "supplier_transactions_delete" ON public.supplier_transactions FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "payments_select" ON public.payments FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "payments_insert" ON public.payments FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "payments_update" ON public.payments FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "payments_delete" ON public.payments FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "liabilities_select" ON public.liabilities FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "liabilities_insert" ON public.liabilities FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "liabilities_update" ON public.liabilities FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "liabilities_delete" ON public.liabilities FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "liability_payments_select" ON public.liability_payments FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.liabilities l WHERE l.id = liability_id AND (l.user_id = auth.uid() OR l.user_id IS NULL))
);
CREATE POLICY "liability_payments_insert" ON public.liability_payments FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.liabilities l WHERE l.id = liability_id AND (l.user_id = auth.uid() OR l.user_id IS NULL))
);
CREATE POLICY "liability_payments_update" ON public.liability_payments FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.liabilities l WHERE l.id = liability_id AND (l.user_id = auth.uid() OR l.user_id IS NULL))
);
CREATE POLICY "liability_payments_delete" ON public.liability_payments FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.liabilities l WHERE l.id = liability_id AND (l.user_id = auth.uid() OR l.user_id IS NULL))
);

-- Note: The app should set user_id = auth.uid() on insert for new rows.
-- Backfill existing rows with a specific user if needed:
-- UPDATE public.clients SET user_id = '...' WHERE user_id IS NULL;
-- (repeat for other tables)
