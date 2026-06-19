-- Seed ETA item codes from your registered EGS catalog (Promed taxpayer).
-- Run AFTER supabase_eta_codes_catalog.sql in the Supabase SQL editor.
-- Safe to re-run: upserts by item_code.

INSERT INTO public.eta_item_codes (code_type, item_code, item_name, category, unit_type)
VALUES
  ('EGS', 'EG-373950896-10218', 'Ventlitor mek evo5', 'Medical Devices', 'EA'),
  ('EGS', 'EG-614087716-10', 'Alumital', 'Aluminium (Recycled/Renewable)', 'KGM'),
  ('EGS', 'EG-614087716-9', 'Stainless Steel', 'Steel (Recycled/Renewable)', 'KGM'),
  ('EGS', 'EG-614087716-4', 'Iron', 'Iron (Formed)', 'KGM'),
  ('EGS', 'EG-614087716-1', 'Repair Medical Devices', 'Maintenance/Repair Services', 'EA'),
  ('EGS', 'EG-614087716-2', 'Medical devices production', 'Medical Devices', 'EA'),
  ('EGS', 'EG-614087716-3', 'Supplying medical supplies', 'Support Component of a Medical Device', 'EA')
ON CONFLICT (item_code) DO UPDATE SET
  code_type = EXCLUDED.code_type,
  item_name = EXCLUDED.item_name,
  category = EXCLUDED.category,
  unit_type = EXCLUDED.unit_type;
