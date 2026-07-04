-- =============================================================================
-- Promed: Compliance & Regulatory Management
-- =============================================================================
-- Run this in Supabase SQL Editor after the main schema + supabase_liabilities.sql.
-- Creates the Compliance module tables, triggers and Row Level Security.
--
-- Tables:
--   compliance_authorities              user-defined regulatory authorities
--   compliance_categories               item category seed list (system + user)
--   compliance_items                    core entity
--   compliance_item_tasks               per-item checklist
--   compliance_item_documents           uploaded file metadata (Storage-backed)
--   compliance_item_expenses            costs linked to an item
--   compliance_item_events              auto-recorded timeline
--   compliance_authority_reminder_rules reminder thresholds per authority
--
-- All tables follow the existing conventions:
--   - id SERIAL PK
--   - created_at / updated_at TIMESTAMPTZ
--   - user_id UUID FK auth.users(id) ON DELETE CASCADE  (nullable for legacy)
--   - updated_at trigger uses update_updated_at_column()
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Authorities
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_authorities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    code VARCHAR(50),
    country VARCHAR(100),
    description TEXT,
    color VARCHAR(20) DEFAULT 'rose',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_authorities_user_id
    ON public.compliance_authorities(user_id);


-- -----------------------------------------------------------------------------
-- 2. Categories (system seed + user-created)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_categories (
    id SERIAL PRIMARY KEY,
    key VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_categories_user_id
    ON public.compliance_categories(user_id);

-- Unique (key, is_system) lets ON CONFLICT DO NOTHING safely skip seeds that
-- already exist, while still allowing users to create their own category with
-- the same key (different is_system=FALSE row).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_compliance_categories_key_system
    ON public.compliance_categories(key, is_system);

-- Seed system categories if not present (idempotent).
-- Explicit column list + NOT IN avoids the "VALUES has N columns but target has M" planner mismatch.
INSERT INTO public.compliance_categories (key, name, is_system)
VALUES
    ('license',         'License',         TRUE),
    ('certificate',     'Certificate',     TRUE),
    ('permit',          'Government Permit', TRUE),
    ('registration',    'Registration',    TRUE),
    ('audit',           'Audit',           TRUE),
    ('inspection',      'Inspection',      TRUE),
    ('tax',             'Tax Obligation',  TRUE),
    ('legal',           'Legal Document',  TRUE),
    ('renewal',         'Renewal',         TRUE),
    ('other',           'Other',           TRUE)
ON CONFLICT DO NOTHING;


-- -----------------------------------------------------------------------------
-- 3. Compliance Items (core entity)
-- -----------------------------------------------------------------------------
-- status:      active | expired | pending_renewal | archived
-- priority:    low | medium | high | critical
-- metadata:    reserved jsonb column for AI-extracted fields in the future.
CREATE TABLE IF NOT EXISTS public.compliance_items (
    id SERIAL PRIMARY KEY,
    title VARCHAR(300) NOT NULL,
    authority_id INTEGER REFERENCES public.compliance_authorities(id) ON DELETE SET NULL,
    category_id INTEGER REFERENCES public.compliance_categories(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'expired', 'pending_renewal', 'archived')),
    priority VARCHAR(20) NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    owner_email VARCHAR(200),
    reference_number VARCHAR(200),
    description TEXT,
    notes TEXT,
    issue_date DATE,
    expiry_date DATE,
    renewal_period_days INTEGER CHECK (renewal_period_days IS NULL OR renewal_period_days > 0),
    next_reminder_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_items_user_id
    ON public.compliance_items(user_id);
CREATE INDEX IF NOT EXISTS idx_compliance_items_authority_id
    ON public.compliance_items(authority_id);
CREATE INDEX IF NOT EXISTS idx_compliance_items_expiry_date
    ON public.compliance_items(expiry_date);
CREATE INDEX IF NOT EXISTS idx_compliance_items_status
    ON public.compliance_items(status);


-- -----------------------------------------------------------------------------
-- 4. Tasks (per-item checklist)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_item_tasks (
    id SERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES public.compliance_items(id) ON DELETE CASCADE,
    title VARCHAR(300) NOT NULL,
    is_done BOOLEAN NOT NULL DEFAULT FALSE,
    due_date DATE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    completed_at TIMESTAMP WITH TIME ZONE,
    completed_by_email VARCHAR(200),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_item_tasks_item_id
    ON public.compliance_item_tasks(item_id);


-- -----------------------------------------------------------------------------
-- 5. Documents (Supabase Storage metadata)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_item_documents (
    id SERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES public.compliance_items(id) ON DELETE CASCADE,
    file_name VARCHAR(500) NOT NULL,
    storage_path TEXT NOT NULL,
    bucket VARCHAR(100) NOT NULL DEFAULT 'compliance-documents',
    mime_type VARCHAR(200),
    size_bytes BIGINT,
    version INTEGER NOT NULL DEFAULT 1,
    previous_version_id INTEGER REFERENCES public.compliance_item_documents(id) ON DELETE SET NULL,
    uploaded_by_email VARCHAR(200),
    notes TEXT,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_item_documents_item_id
    ON public.compliance_item_documents(item_id);


-- -----------------------------------------------------------------------------
-- 6. Expenses
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_item_expenses (
    id SERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES public.compliance_items(id) ON DELETE CASCADE,
    expense_type VARCHAR(50) NOT NULL DEFAULT 'other'
        CHECK (expense_type IN (
            'government_fee', 'consultant_fee', 'inspection_fee',
            'certification_fee', 'travel', 'other'
        )),
    amount NUMERIC NOT NULL CHECK (amount >= 0),
    currency VARCHAR(10) NOT NULL DEFAULT 'EGP',
    expense_date DATE NOT NULL,
    vendor VARCHAR(200),
    reference_number VARCHAR(200),
    notes TEXT,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_item_expenses_item_id
    ON public.compliance_item_expenses(item_id);
CREATE INDEX IF NOT EXISTS idx_compliance_item_expenses_date
    ON public.compliance_item_expenses(expense_date);


-- -----------------------------------------------------------------------------
-- 7. Events (timeline / activity log)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_item_events (
    id SERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES public.compliance_items(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    actor_email VARCHAR(200),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_item_events_item_id
    ON public.compliance_item_events(item_id);
CREATE INDEX IF NOT EXISTS idx_compliance_item_events_created_at
    ON public.compliance_item_events(created_at DESC);


-- -----------------------------------------------------------------------------
-- 8. Authority Reminder Rules (per-authority thresholds)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_authority_reminder_rules (
    id SERIAL PRIMARY KEY,
    authority_id INTEGER REFERENCES public.compliance_authorities(id) ON DELETE CASCADE,
    days_before INTEGER NOT NULL CHECK (days_before >= 0),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT compliance_authority_reminder_rules_unique UNIQUE (authority_id, days_before)
);

CREATE INDEX IF NOT EXISTS idx_compliance_authority_reminder_rules_authority_id
    ON public.compliance_authority_reminder_rules(authority_id);


-- =============================================================================
-- Triggers
-- =============================================================================

-- updated_at on all tables ---------------------------------------------------
DROP TRIGGER IF EXISTS update_compliance_authorities_updated_at
    ON public.compliance_authorities;
CREATE TRIGGER update_compliance_authorities_updated_at
    BEFORE UPDATE ON public.compliance_authorities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_compliance_categories_updated_at
    ON public.compliance_categories;
CREATE TRIGGER update_compliance_categories_updated_at
    BEFORE UPDATE ON public.compliance_categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_compliance_items_updated_at
    ON public.compliance_items;
CREATE TRIGGER update_compliance_items_updated_at
    BEFORE UPDATE ON public.compliance_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_compliance_item_tasks_updated_at
    ON public.compliance_item_tasks;
CREATE TRIGGER update_compliance_item_tasks_updated_at
    BEFORE UPDATE ON public.compliance_item_tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_compliance_item_documents_updated_at
    ON public.compliance_item_documents;
CREATE TRIGGER update_compliance_item_documents_updated_at
    BEFORE UPDATE ON public.compliance_item_documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_compliance_item_expenses_updated_at
    ON public.compliance_item_expenses;
CREATE TRIGGER update_compliance_item_expenses_updated_at
    BEFORE UPDATE ON public.compliance_item_expenses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_compliance_authority_reminder_rules_updated_at
    ON public.compliance_authority_reminder_rules;
CREATE TRIGGER update_compliance_authority_reminder_rules_updated_at
    BEFORE UPDATE ON public.compliance_authority_reminder_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- Compliance items: log events on create / status change / renewal ----------
CREATE OR REPLACE FUNCTION log_compliance_item_event()
RETURNS TRIGGER SECURITY DEFINER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.compliance_item_events (item_id, event_type, actor_email, payload)
        VALUES (NEW.id, 'created', NEW.owner_email,
                jsonb_build_object('title', NEW.title));
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Status change
        IF OLD.status IS DISTINCT FROM NEW.status THEN
            INSERT INTO public.compliance_item_events (item_id, event_type, actor_email, payload)
            VALUES (NEW.id, 'status_changed', NULL,
                    jsonb_build_object('from', OLD.status, 'to', NEW.status));
        END IF;
        -- Owner change
        IF OLD.owner_email IS DISTINCT FROM NEW.owner_email THEN
            INSERT INTO public.compliance_item_events (item_id, event_type, actor_email, payload)
            VALUES (NEW.id, 'owner_changed', NULL,
                    jsonb_build_object('from', OLD.owner_email, 'to', NEW.owner_email));
        END IF;
        -- Expiry date changed (treated as renewal)
        IF OLD.expiry_date IS DISTINCT FROM NEW.expiry_date THEN
            INSERT INTO public.compliance_item_events (item_id, event_type, actor_email, payload)
            VALUES (NEW.id, 'renewed', NULL,
                    jsonb_build_object('from', OLD.expiry_date, 'to', NEW.expiry_date));
        END IF;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_compliance_item_event ON public.compliance_items;
CREATE TRIGGER trg_log_compliance_item_event
    AFTER INSERT OR UPDATE ON public.compliance_items
    FOR EACH ROW EXECUTE FUNCTION log_compliance_item_event();


-- Documents: log uploaded / replaced events ---------------------------------
CREATE OR REPLACE FUNCTION log_compliance_document_event()
RETURNS TRIGGER SECURITY DEFINER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Orphan import rows have no parent item yet; skip timeline write.
        IF NEW.item_id IS NULL THEN
            RETURN NEW;
        END IF;
        INSERT INTO public.compliance_item_events (item_id, event_type, actor_email, payload)
        VALUES (
            NEW.item_id,
            CASE WHEN NEW.previous_version_id IS NULL THEN 'document_uploaded' ELSE 'document_replaced' END,
            NEW.uploaded_by_email,
            jsonb_build_object(
                'document_id', NEW.id,
                'file_name', NEW.file_name,
                'version', NEW.version,
                'previous_version_id', NEW.previous_version_id
            )
        );
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_compliance_document_event ON public.compliance_item_documents;
CREATE TRIGGER trg_log_compliance_document_event
    AFTER INSERT ON public.compliance_item_documents
    FOR EACH ROW EXECUTE FUNCTION log_compliance_document_event();


-- =============================================================================
-- Row Level Security
-- =============================================================================
ALTER TABLE public.compliance_authorities              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_categories               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_items                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_item_tasks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_item_documents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_item_expenses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_item_events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_authority_reminder_rules ENABLE ROW LEVEL SECURITY;

-- Top-level tables: direct user_id ownership.
CREATE POLICY "compliance_authorities_select" ON public.compliance_authorities
    FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "compliance_authorities_insert" ON public.compliance_authorities
    FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "compliance_authorities_update" ON public.compliance_authorities
    FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "compliance_authorities_delete" ON public.compliance_authorities
    FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "compliance_categories_select" ON public.compliance_categories
    FOR SELECT USING (
        is_system = TRUE
        OR auth.uid() = user_id
        OR user_id IS NULL
    );
CREATE POLICY "compliance_categories_insert" ON public.compliance_categories
    FOR INSERT WITH CHECK (is_system = FALSE AND (auth.uid() = user_id OR user_id IS NULL));
CREATE POLICY "compliance_categories_update" ON public.compliance_categories
    FOR UPDATE USING (is_system = FALSE AND (auth.uid() = user_id OR user_id IS NULL));
CREATE POLICY "compliance_categories_delete" ON public.compliance_categories
    FOR DELETE USING (is_system = FALSE AND (auth.uid() = user_id OR user_id IS NULL));

CREATE POLICY "compliance_items_select" ON public.compliance_items
    FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "compliance_items_insert" ON public.compliance_items
    FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "compliance_items_update" ON public.compliance_items
    FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "compliance_items_delete" ON public.compliance_items
    FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);

-- Child tables inherit visibility from the parent item.
CREATE POLICY "compliance_item_tasks_select" ON public.compliance_item_tasks
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.compliance_items i
                WHERE i.id = item_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );
CREATE POLICY "compliance_item_tasks_insert" ON public.compliance_item_tasks
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.compliance_items i
                WHERE i.id = item_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );
CREATE POLICY "compliance_item_tasks_update" ON public.compliance_item_tasks
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.compliance_items i
                WHERE i.id = item_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );
CREATE POLICY "compliance_item_tasks_delete" ON public.compliance_item_tasks
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM public.compliance_items i
                WHERE i.id = item_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );

CREATE POLICY "compliance_item_documents_select" ON public.compliance_item_documents
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.compliance_items i
                WHERE i.id = item_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );
CREATE POLICY "compliance_item_documents_insert" ON public.compliance_item_documents
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.compliance_items i
                WHERE i.id = item_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );
CREATE POLICY "compliance_item_documents_update" ON public.compliance_item_documents
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.compliance_items i
                WHERE i.id = item_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );
CREATE POLICY "compliance_item_documents_delete" ON public.compliance_item_documents
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM public.compliance_items i
                WHERE i.id = item_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );

CREATE POLICY "compliance_item_expenses_select" ON public.compliance_item_expenses
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.compliance_items i
                WHERE i.id = item_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );
CREATE POLICY "compliance_item_expenses_insert" ON public.compliance_item_expenses
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.compliance_items i
                WHERE i.id = item_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );
CREATE POLICY "compliance_item_expenses_update" ON public.compliance_item_expenses
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.compliance_items i
                WHERE i.id = item_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );
CREATE POLICY "compliance_item_expenses_delete" ON public.compliance_item_expenses
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM public.compliance_items i
                WHERE i.id = item_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );

CREATE POLICY "compliance_item_events_select" ON public.compliance_item_events
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.compliance_items i
                WHERE i.id = item_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );
CREATE POLICY "compliance_item_events_insert" ON public.compliance_item_events
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.compliance_items i
                WHERE i.id = item_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );

CREATE POLICY "compliance_authority_reminder_rules_select" ON public.compliance_authority_reminder_rules
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.compliance_authorities a
                WHERE a.id = authority_id AND (a.user_id = auth.uid() OR a.user_id IS NULL))
        OR user_id = auth.uid()
        OR user_id IS NULL
    );
CREATE POLICY "compliance_authority_reminder_rules_insert" ON public.compliance_authority_reminder_rules
    FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "compliance_authority_reminder_rules_update" ON public.compliance_authority_reminder_rules
    FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "compliance_authority_reminder_rules_delete" ON public.compliance_authority_reminder_rules
    FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);


-- =============================================================================
-- Realtime (optional – uncomment to subscribe to changes in the UI)
-- =============================================================================
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.compliance_authorities;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.compliance_items;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.compliance_item_tasks;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.compliance_item_documents;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.compliance_item_expenses;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.compliance_item_events;