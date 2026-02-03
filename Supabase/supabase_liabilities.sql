-- =============================================================================
-- Promed: Liabilities & Expenses (الجه، البيان، القيمة، مدفوع، متبقى)
-- =============================================================================
-- Run this in Supabase SQL Editor after the main schema.
-- Creates: liabilities, liability_payments, trigger to keep paid/remaining in sync.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Liabilities Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.liabilities (
    id SERIAL PRIMARY KEY,
    category VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    total_amount NUMERIC NOT NULL CHECK (total_amount >= 0),
    paid_amount NUMERIC DEFAULT 0 CHECK (paid_amount >= 0),
    remaining_amount NUMERIC NOT NULL CHECK (remaining_amount >= 0),
    due_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT liabilities_amounts_check
        CHECK (total_amount = paid_amount + remaining_amount)
);

-- -----------------------------------------------------------------------------
-- 2. Liability Payments Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.liability_payments (
    id SERIAL PRIMARY KEY,
    liability_id INTEGER NOT NULL REFERENCES public.liabilities(id) ON DELETE CASCADE,
    payment_amount NUMERIC NOT NULL CHECK (payment_amount > 0),
    payment_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_liability_payments_liability_id
    ON public.liability_payments(liability_id);
CREATE INDEX IF NOT EXISTS idx_liability_payments_payment_date
    ON public.liability_payments(payment_date);

-- -----------------------------------------------------------------------------
-- 3. Trigger: Recalculate liability paid/remaining when payments change
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_liability_paid_remaining()
RETURNS TRIGGER AS $$
DECLARE
    lid INTEGER;
    new_paid NUMERIC;
BEGIN
    -- Determine which liability id(s) to recalculate
    IF TG_OP = 'DELETE' THEN
        lid := OLD.liability_id;
    ELSIF TG_OP = 'UPDATE' AND OLD.liability_id <> NEW.liability_id THEN
        -- Payment moved to another liability: update both
        SELECT COALESCE(SUM(payment_amount), 0) INTO new_paid
        FROM public.liability_payments WHERE liability_id = OLD.liability_id;
        UPDATE public.liabilities
        SET paid_amount = new_paid, remaining_amount = total_amount - new_paid, updated_at = NOW()
        WHERE id = OLD.liability_id;
        lid := NEW.liability_id;
    ELSIF TG_OP = 'UPDATE' THEN
        lid := NEW.liability_id;
    ELSE
        lid := NEW.liability_id;
    END IF;

    SELECT COALESCE(SUM(payment_amount), 0) INTO new_paid
    FROM public.liability_payments WHERE liability_id = lid;

    UPDATE public.liabilities
    SET paid_amount = new_paid, remaining_amount = total_amount - new_paid, updated_at = NOW()
    WHERE id = lid;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_liability_paid_trigger ON public.liability_payments;
CREATE TRIGGER sync_liability_paid_trigger
    AFTER INSERT OR UPDATE OR DELETE ON public.liability_payments
    FOR EACH ROW
    EXECUTE FUNCTION sync_liability_paid_remaining();

-- -----------------------------------------------------------------------------
-- 4. Updated_at trigger for liabilities
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS update_liabilities_updated_at ON public.liabilities;
CREATE TRIGGER update_liabilities_updated_at
    BEFORE UPDATE ON public.liabilities
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- 5. Realtime (optional – uncomment to subscribe to changes)
-- -----------------------------------------------------------------------------
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.liabilities;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.liability_payments;
