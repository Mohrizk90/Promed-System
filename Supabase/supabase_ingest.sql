-- =============================================================================
-- Promed: Ingest sheet data into Supabase (run in Supabase SQL Editor)
-- =============================================================================
-- Aligned with: Supabase/supabase_schema.sql
-- Run the schema script first, then this ingest.
--
-- HOW TO RUN:
-- 1. Open Supabase Dashboard → SQL Editor.
-- 2. Paste this entire script (or run sections 1 → 2 → 3 → 4 in order).
-- 3. Execute. Safe to re-run: skips existing client/supplier/products; transactions
--    will duplicate if run twice (delete from public.client_transactions /
--    public.supplier_transactions WHERE client_id/supplier_id = Import id if needed).
--
-- Schema: public.clients, public.suppliers, public.products,
--         public.client_transactions, public.supplier_transactions
-- Constraints: quantity > 0, total_amount = paid_amount + remaining_amount,
--              unit_price >= 0. Payments table not populated by this script.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Placeholder client (Table 1) and supplier (Table 2)
-- -----------------------------------------------------------------------------
INSERT INTO public.clients (client_name)
SELECT 'Import Client'
WHERE NOT EXISTS (SELECT 1 FROM public.clients WHERE client_name = 'Import Client');

INSERT INTO public.suppliers (supplier_name)
SELECT 'Import Supplier'
WHERE NOT EXISTS (SELECT 1 FROM public.suppliers WHERE supplier_name = 'Import Supplier');

-- -----------------------------------------------------------------------------
-- 2. Products (from both tables; product_name = description, model = model)
-- Skips rows that already exist (same product_name + model). unit_price >= 0.
-- -----------------------------------------------------------------------------
INSERT INTO public.products (product_name, model, unit_price)
SELECT v.product_name, v.model, v.unit_price
FROM (VALUES
  ('ص كنترول حضانة'::varchar, 'fanem'::varchar, 2000::numeric),
  ('BATTERY CABINET', '3- LEVEL', 17000),
  ('BATTERY RACK', '4+ LVEL', 16000),
  ('سريلر رعاية', 'hi - lo', 55000),
  ('ص كنترول سرير', NULL::varchar, 2100),
  ('vent trolly', NULL, 6500),
  ('سابق', NULL, 4250),
  ('control bili 360', 'ptl 360', 1800),
  ('شاسية', 'vent', 1250),
  ('skin sensor', '2.25k', 570),
  ('remote control', NULL, 350),
  ('tact switch', '12*12*8', 2.5),
  ('خامات', NULL, 17000),
  ('touch screen', '5 inch', 2400),
  ('راكات mps', '100*90*140', 800),
  ('اكسسوار', NULL, 7300),
  ('فاتورة', NULL, 2250)
) AS v(product_name, model, unit_price)
WHERE NOT EXISTS (
  SELECT 1 FROM public.products p
  WHERE p.product_name = v.product_name
    AND (p.model IS NOT DISTINCT FROM v.model)
);

-- -----------------------------------------------------------------------------
-- 3. Client transactions (Table 1 – top section; excluding grand total & zero rows)
-- Schema: quantity > 0, total_amount = paid_amount + remaining_amount
-- -----------------------------------------------------------------------------
INSERT INTO public.client_transactions (
  client_id,
  product_id,
  quantity,
  unit_price,
  total_amount,
  paid_amount,
  remaining_amount,
  transaction_date
)
SELECT
  (SELECT client_id FROM public.clients WHERE client_name = 'Import Client' LIMIT 1),
  (SELECT product_id FROM public.products WHERE product_name = 'ص كنترول حضانة' AND (model IS NOT DISTINCT FROM 'fanem') ORDER BY product_id DESC LIMIT 1),
  1, 2000, 2000, 0, 2000, '2026-01-02'::date
UNION ALL SELECT
  (SELECT client_id FROM public.clients WHERE client_name = 'Import Client' LIMIT 1),
  (SELECT product_id FROM public.products WHERE product_name = 'BATTERY CABINET' AND (model IS NOT DISTINCT FROM '3- LEVEL') ORDER BY product_id DESC LIMIT 1),
  3, 17000, 51000, 0, 51000, '2026-01-17'::date
UNION ALL SELECT
  (SELECT client_id FROM public.clients WHERE client_name = 'Import Client' LIMIT 1),
  (SELECT product_id FROM public.products WHERE product_name = 'BATTERY RACK' AND (model IS NOT DISTINCT FROM '4+ LVEL') ORDER BY product_id DESC LIMIT 1),
  4, 16000, 64000, 0, 64000, '2026-01-17'::date
UNION ALL SELECT
  (SELECT client_id FROM public.clients WHERE client_name = 'Import Client' LIMIT 1),
  (SELECT product_id FROM public.products WHERE product_name = 'سريلر رعاية' AND (model IS NOT DISTINCT FROM 'hi - lo') ORDER BY product_id DESC LIMIT 1),
  1, 55000, 55000, 55000, 0, '2026-01-17'::date
UNION ALL SELECT
  (SELECT client_id FROM public.clients WHERE client_name = 'Import Client' LIMIT 1),
  (SELECT product_id FROM public.products WHERE product_name = 'ص كنترول سرير' AND (model IS NOT DISTINCT FROM NULL) ORDER BY product_id DESC LIMIT 1),
  2, 2100, 4200, 4200, 0, '2026-01-17'::date
UNION ALL SELECT
  (SELECT client_id FROM public.clients WHERE client_name = 'Import Client' LIMIT 1),
  (SELECT product_id FROM public.products WHERE product_name = 'vent trolly' AND (model IS NOT DISTINCT FROM NULL) ORDER BY product_id DESC LIMIT 1),
  11, 6500, 71500, 50000, 21500, '2026-01-17'::date
UNION ALL SELECT
  (SELECT client_id FROM public.clients WHERE client_name = 'Import Client' LIMIT 1),
  (SELECT product_id FROM public.products WHERE product_name = 'سابق' AND (model IS NOT DISTINCT FROM NULL) ORDER BY product_id DESC LIMIT 1),
  1, 4250, 4250, 0, 4250, '2026-01-17'::date;

-- -----------------------------------------------------------------------------
-- 4. Supplier transactions (Table 2 – bottom section; excluding grand total)
-- Schema: quantity > 0, total_amount = paid_amount + remaining_amount
-- -----------------------------------------------------------------------------
INSERT INTO public.supplier_transactions (
  supplier_id,
  product_id,
  quantity,
  unit_price,
  total_amount,
  paid_amount,
  remaining_amount,
  transaction_date
)
SELECT
  (SELECT supplier_id FROM public.suppliers WHERE supplier_name = 'Import Supplier' LIMIT 1),
  (SELECT product_id FROM public.products WHERE product_name = 'control bili 360' AND (model IS NOT DISTINCT FROM 'ptl 360') ORDER BY product_id DESC LIMIT 1),
  20, 1800, 36000, 25000, 11000, '2026-01-02'::date
UNION ALL SELECT
  (SELECT supplier_id FROM public.suppliers WHERE supplier_name = 'Import Supplier' LIMIT 1),
  (SELECT product_id FROM public.products WHERE product_name = 'شاسية' AND (model IS NOT DISTINCT FROM 'vent') ORDER BY product_id DESC LIMIT 1),
  12, 1250, 15000, 15000, 0, '2026-01-02'::date
UNION ALL SELECT
  (SELECT supplier_id FROM public.suppliers WHERE supplier_name = 'Import Supplier' LIMIT 1),
  (SELECT product_id FROM public.products WHERE product_name = 'skin sensor' AND (model IS NOT DISTINCT FROM '2.25k') ORDER BY product_id DESC LIMIT 1),
  5, 570, 2850, 2850, 0, '2026-01-02'::date
UNION ALL SELECT
  (SELECT supplier_id FROM public.suppliers WHERE supplier_name = 'Import Supplier' LIMIT 1),
  (SELECT product_id FROM public.products WHERE product_name = 'remote control' AND (model IS NOT DISTINCT FROM NULL) ORDER BY product_id DESC LIMIT 1),
  4, 350, 1400, 1400, 0, '2026-01-02'::date
UNION ALL SELECT
  (SELECT supplier_id FROM public.suppliers WHERE supplier_name = 'Import Supplier' LIMIT 1),
  (SELECT product_id FROM public.products WHERE product_name = 'tact switch' AND (model IS NOT DISTINCT FROM '12*12*8') ORDER BY product_id DESC LIMIT 1),
  100, 2.5, 250, 250, 0, '2026-01-02'::date
UNION ALL SELECT
  (SELECT supplier_id FROM public.suppliers WHERE supplier_name = 'Import Supplier' LIMIT 1),
  (SELECT product_id FROM public.products WHERE product_name = 'خامات' AND (model IS NOT DISTINCT FROM NULL) ORDER BY product_id DESC LIMIT 1),
  1, 17000, 17000, 17000, 0, '2026-01-17'::date
UNION ALL SELECT
  (SELECT supplier_id FROM public.suppliers WHERE supplier_name = 'Import Supplier' LIMIT 1),
  (SELECT product_id FROM public.products WHERE product_name = 'touch screen' AND (model IS NOT DISTINCT FROM '5 inch') ORDER BY product_id DESC LIMIT 1),
  10, 2400, 24000, 24000, 0, '2026-01-17'::date
UNION ALL SELECT
  (SELECT supplier_id FROM public.suppliers WHERE supplier_name = 'Import Supplier' LIMIT 1),
  (SELECT product_id FROM public.products WHERE product_name = 'راكات mps' AND (model IS NOT DISTINCT FROM '100*90*140') ORDER BY product_id DESC LIMIT 1),
  4, 800, 3200, 3200, 0, '2026-01-17'::date
UNION ALL SELECT
  (SELECT supplier_id FROM public.suppliers WHERE supplier_name = 'Import Supplier' LIMIT 1),
  (SELECT product_id FROM public.products WHERE product_name = 'اكسسوار' AND (model IS NOT DISTINCT FROM NULL) ORDER BY product_id DESC LIMIT 1),
  1, 7300, 7300, 7300, 0, '2026-01-17'::date
UNION ALL SELECT
  (SELECT supplier_id FROM public.suppliers WHERE supplier_name = 'Import Supplier' LIMIT 1),
  (SELECT product_id FROM public.products WHERE product_name = 'فاتورة' AND (model IS NOT DISTINCT FROM NULL) ORDER BY product_id DESC LIMIT 1),
  1, 2250, 2250, 2250, 0, '2026-01-20'::date;
