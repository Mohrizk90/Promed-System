-- ETA (Egyptian Tax Authority) item-code catalog.
-- Run in the Supabase SQL editor.
--
-- Stores the EGS/GS1 codes registered for the taxpayer so they can be picked
-- from a dropdown on products and invoice lines instead of typed by hand.

CREATE TABLE IF NOT EXISTS public.eta_item_codes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code_type text NOT NULL DEFAULT 'EGS',
  item_code text NOT NULL,
  item_name text,
  category text,
  unit_type text DEFAULT 'EA',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS eta_item_codes_code_uidx
  ON public.eta_item_codes (item_code);

ALTER TABLE public.eta_item_codes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'eta_item_codes'
      AND policyname = 'eta_item_codes_all'
  ) THEN
    CREATE POLICY eta_item_codes_all ON public.eta_item_codes
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMENT ON TABLE public.eta_item_codes IS 'Catalog of ETA registered item codes (EGS/GS1) for selection on invoices';
