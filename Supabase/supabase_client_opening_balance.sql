-- =============================================================================
-- Promed: Per-client opening balance (brought forward)
-- =============================================================================
-- A single carried-in balance per client, applied before any recorded activity.
-- It "rolls forward" automatically: a client's current balance is
--   opening_balance + sum(all invoices) - sum(all payments)
-- and each statement period derives its opening row from this plus the activity
-- before the period start.
--
-- Sign convention:
--   positive  -> client OWED you when you started (adds to what they owe)
--   negative  -> client had CREDIT when you started (reduces what they owe)
--
-- Example: a client who was 1,002 ahead (prepaid) at the start:
--   UPDATE public.clients SET opening_balance = -1002 WHERE client_name = 'MPS';
-- =============================================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS opening_balance NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.clients.opening_balance IS
  'Balance carried in before any recorded activity. Positive = client owed you; negative = client had credit.';
