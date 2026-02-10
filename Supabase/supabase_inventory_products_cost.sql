-- =============================================================================
-- Promed: Product cost (unit_cost) + Inventory items table
-- =============================================================================
-- Run in Supabase SQL Editor.
-- - Adds unit_cost to products (cost price; unit_price remains sell price).
-- - Creates inventory_items for generic inventory items.
-- =============================================================================

-- 1. Add unit_cost to products (nullable for existing rows)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'unit_cost'
    ) THEN
        ALTER TABLE public.products
        ADD COLUMN unit_cost NUMERIC CHECK (unit_cost >= 0);
    END IF;
END $$;

-- 2. Inventory items table (generic items, not linked to transactions)
CREATE TABLE IF NOT EXISTS public.inventory_items (
    item_id SERIAL PRIMARY KEY,
    name VARCHAR NOT NULL,
    quantity NUMERIC NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    unit_cost NUMERIC DEFAULT 0 CHECK (unit_cost >= 0),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_name ON public.inventory_items(name);

-- Ensure trigger function exists (from main schema)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_inventory_items_updated_at ON public.inventory_items;
CREATE TRIGGER update_inventory_items_updated_at
    BEFORE UPDATE ON public.inventory_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
