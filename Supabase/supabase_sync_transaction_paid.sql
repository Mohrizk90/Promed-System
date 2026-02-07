-- =============================================================================
-- Promed: Sync transaction paid_amount / remaining_amount from payments
-- =============================================================================
-- Run after supabase_schema.sql. When payments are inserted/updated/deleted,
-- recalculate paid_amount and remaining_amount on the corresponding
-- client_transaction or supplier_transaction row.
-- =============================================================================

-- Helper: recalculate paid/remaining for one transaction
CREATE OR REPLACE FUNCTION sync_one_transaction_paid(tid INTEGER, ttyp VARCHAR(10))
RETURNS void AS $$
DECLARE
    new_paid NUMERIC;
BEGIN
    IF ttyp IS NULL OR tid IS NULL THEN
        RETURN;
    END IF;

    SELECT COALESCE(SUM(payment_amount), 0) INTO new_paid
    FROM public.payments
    WHERE transaction_id = tid AND transaction_type = ttyp;

    IF ttyp = 'client' THEN
        UPDATE public.client_transactions
        SET paid_amount = new_paid, remaining_amount = total_amount - new_paid, updated_at = NOW()
        WHERE transaction_id = tid;
    ELSIF ttyp = 'supplier' THEN
        UPDATE public.supplier_transactions
        SET paid_amount = new_paid, remaining_amount = total_amount - new_paid, updated_at = NOW()
        WHERE transaction_id = tid;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_transaction_paid_remaining()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM sync_one_transaction_paid(OLD.transaction_id, OLD.transaction_type);
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.transaction_id IS DISTINCT FROM NEW.transaction_id OR OLD.transaction_type IS DISTINCT FROM NEW.transaction_type THEN
            PERFORM sync_one_transaction_paid(OLD.transaction_id, OLD.transaction_type);
        END IF;
        PERFORM sync_one_transaction_paid(NEW.transaction_id, NEW.transaction_type);
        RETURN NEW;
    ELSE
        PERFORM sync_one_transaction_paid(NEW.transaction_id, NEW.transaction_type);
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_transaction_paid_trigger ON public.payments;
CREATE TRIGGER sync_transaction_paid_trigger
    AFTER INSERT OR UPDATE OR DELETE ON public.payments
    FOR EACH ROW
    EXECUTE FUNCTION sync_transaction_paid_remaining();
