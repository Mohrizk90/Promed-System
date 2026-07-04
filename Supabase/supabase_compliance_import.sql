-- =============================================================================
-- Promed: Compliance Document Import (orphan upload + import batches)
-- =============================================================================
-- Run this AFTER supabase_compliance.sql + supabase_compliance_storage.sql +
-- supabase_compliance_docs_ai.sql.
--
-- Pure additive. The existing pipeline (Upload -> Process -> Review -> Store)
-- is unchanged for documents that already belong to an item; we just loosen
-- `compliance_item_documents.item_id` to allow an in-flight "orphan" state
-- so the import experience can feel like Drive/Dropbox.
--
-- Adds:
--   - item_id on compliance_item_documents becomes NULLABLE
--   - 3 new columns on compliance_item_documents:
--       is_orphan              BOOLEAN   (gate for orphan-only UI)
--       intended_authority     VARCHAR
--       intended_title         VARCHAR
--   - 1 new table  compliance_document_import_batches
--       (one row per multi-file drop session; lets us track + retry)
--   - 3 RPC functions:
--       create_import_batch, create_item_from_orphan, link_orphan_to_item
--   - RLS on the new table + helper index
--
-- The whole file is idempotent so it can be re-run without errors.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Make item_id nullable + orphan columns
-- -----------------------------------------------------------------------------
ALTER TABLE public.compliance_item_documents
    ALTER COLUMN item_id DROP NOT NULL;

ALTER TABLE public.compliance_item_documents
    ADD COLUMN IF NOT EXISTS is_orphan           BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS intended_authority  VARCHAR(200),
    ADD COLUMN IF NOT EXISTS intended_title      VARCHAR(300);

CREATE INDEX IF NOT EXISTS idx_compliance_item_documents_orphan
    ON public.compliance_item_documents(is_orphan)
    WHERE is_orphan = TRUE;


-- -----------------------------------------------------------------------------
-- 2. Import batches (one row per drag-drop session)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_document_import_batches (
    id             SERIAL PRIMARY KEY,
    user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    file_count     INTEGER NOT NULL DEFAULT 0,
    success_count  INTEGER NOT NULL DEFAULT 0,
    failure_count  INTEGER NOT NULL DEFAULT 0,
    status         VARCHAR(20) NOT NULL DEFAULT 'in_progress'
                   CHECK (status IN ('in_progress','completed','archived','failed')),
    note           TEXT
);

CREATE INDEX IF NOT EXISTS idx_compliance_document_import_batches_user_id
    ON public.compliance_document_import_batches(user_id);
CREATE INDEX IF NOT EXISTS idx_compliance_document_import_batches_status
    ON public.compliance_document_import_batches(status);

DROP TRIGGER IF EXISTS update_compliance_document_import_batches_updated_at
    ON public.compliance_document_import_batches;
CREATE TRIGGER update_compliance_document_import_batches_updated_at
    BEFORE UPDATE ON public.compliance_document_import_batches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.compliance_document_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "compliance_document_import_batches_select" ON public.compliance_document_import_batches;
CREATE POLICY "compliance_document_import_batches_select" ON public.compliance_document_import_batches
    FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
DROP POLICY IF EXISTS "compliance_document_import_batches_insert" ON public.compliance_document_import_batches;
CREATE POLICY "compliance_document_import_batches_insert" ON public.compliance_document_import_batches
    FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
DROP POLICY IF EXISTS "compliance_document_import_batches_update" ON public.compliance_document_import_batches;
CREATE POLICY "compliance_document_import_batches_update" ON public.compliance_document_import_batches
    FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);
DROP POLICY IF EXISTS "compliance_document_import_batches_delete" ON public.compliance_document_import_batches;
CREATE POLICY "compliance_document_import_batches_delete" ON public.compliance_document_import_batches
    FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);


-- =============================================================================
-- 3. RPC: create_import_batch
--    Called from the frontend before any uploads so the user can track a
--    multi-file drop as one unit. Returns the new batch id.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_import_batch(
    p_file_count INTEGER,
    p_note       TEXT DEFAULT NULL
) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    new_id INTEGER;
BEGIN
    INSERT INTO public.compliance_document_import_batches (user_id, file_count, note)
    VALUES (auth.uid(), COALESCE(p_file_count, 0), p_note)
    RETURNING id INTO new_id;
    RETURN new_id;
END; $$;


-- =============================================================================
-- 4. RPC: link_orphan_to_item
--    Connects an orphan document to an existing compliance_item, then runs
--    apply_extracted_metadata so the parent's columns stay in sync.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.link_orphan_to_item(
    p_document_id  INTEGER,
    p_item_id      INTEGER,
    p_actor_email  VARCHAR,
    p_authoritative BOOLEAN DEFAULT FALSE
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_existing JSONB;
BEGIN
    IF p_item_id IS NULL THEN
        RETURN jsonb_build_object('errors', ARRAY['item_required']);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.compliance_items WHERE id = p_item_id AND (user_id = auth.uid() OR user_id IS NULL)) THEN
        RETURN jsonb_build_object('errors', ARRAY['not_authorized']);
    END IF;

    UPDATE public.compliance_item_documents
    SET item_id   = p_item_id,
        is_orphan = FALSE
    WHERE id = p_document_id AND is_orphan = TRUE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('errors', ARRAY['not_orphan_or_not_found']);
    END IF;

    v_existing := public.apply_extracted_metadata(p_document_id, p_actor_email, p_authoritative);

    -- Treat a successful link as a real "organized" milestone.
    INSERT INTO public.compliance_item_events (item_id, event_type, actor_email, payload)
    VALUES (p_item_id, 'orphan_linked', p_actor_email,
            jsonb_build_object('document_id', p_document_id, 'apply_report', v_existing));

    RETURN v_existing || jsonb_build_object('item_id', p_item_id);
END; $$;

REVOKE ALL ON FUNCTION public.link_orphan_to_item(INTEGER, INTEGER, VARCHAR, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_orphan_to_item(INTEGER, INTEGER, VARCHAR, BOOLEAN) TO authenticated;


-- =============================================================================
-- 5. RPC: create_item_from_orphan
--    Reads extracted metadata (and the optional intended_* hints), inserts a
--    fresh compliance_items row, then flips the orphan onto it and runs
--    apply_extracted_metadata to settle columns.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_item_from_orphan(
    p_document_id INTEGER,
    p_actor_email VARCHAR,
    p_authoritative BOOLEAN DEFAULT FALSE
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_metadata         JSONB;
    v_authority_id     INTEGER;
    v_authority_name   TEXT;
    v_reference        TEXT;
    v_issue            TEXT;
    v_expiry           TEXT;
    v_renewal          NUMERIC;
    v_title            TEXT;
    v_category_id      INTEGER;
    v_priority         VARCHAR(20) := 'medium';
    v_new_item_id      INTEGER;
    v_apply_report     JSONB;
BEGIN
    SELECT extracted_metadata, intended_authority, intended_title
      INTO v_metadata, v_authority_name, v_title
    FROM public.compliance_item_documents
    WHERE id = p_document_id AND is_orphan = TRUE;
    IF v_metadata IS NULL THEN
        RETURN jsonb_build_object('errors', ARRAY['orphan_not_found']);
    END IF;

    v_authority_name := nullif(coalesce(v_authority_name,
                                       v_metadata->>'authority_name'), '');
    v_title          := nullif(coalesce(v_title,
                                       v_metadata->>'title'), '');
    v_reference      := nullif(coalesce(v_metadata->>'reference_number', ''), '');
    v_issue          := nullif(coalesce(v_metadata->>'issue_date',         ''), '');
    v_expiry         := nullif(coalesce(v_metadata->>'expiry_date',        ''), '');
    v_renewal        := nullif(coalesce(v_metadata->>'renewal_period_days',''), '')::NUMERIC;

    IF v_authority_name IS NOT NULL THEN
        SELECT id INTO v_authority_id
        FROM public.compliance_authorities
        WHERE lower(name) = lower(v_authority_name)
        ORDER BY id LIMIT 1;
        IF v_authority_id IS NULL THEN
            INSERT INTO public.compliance_authorities (name, user_id)
            VALUES (v_authority_name, auth.uid())
            RETURNING id INTO v_authority_id;
        END IF;
    END IF;

    INSERT INTO public.compliance_items (
        title, authority_id, status, priority, owner_email,
        reference_number, issue_date, expiry_date, renewal_period_days,
        user_id
    )
    VALUES (
        COALESCE(v_title, 'Untitled item'),
        v_authority_id,
        'active',
        v_priority,
        p_actor_email,
        v_reference,
        CASE WHEN v_issue   IS NOT NULL THEN v_issue::date   END,
        CASE WHEN v_expiry  IS NOT NULL THEN v_expiry::date  END,
        CASE WHEN v_renewal IS NOT NULL THEN v_renewal::int END,
        auth.uid()
    )
    RETURNING id INTO v_new_item_id;

    UPDATE public.compliance_item_documents
    SET item_id   = v_new_item_id,
        is_orphan = FALSE
    WHERE id = p_document_id;

    v_apply_report := public.apply_extracted_metadata(p_document_id, p_actor_email, p_authoritative);

    INSERT INTO public.compliance_item_events (item_id, event_type, actor_email, payload)
    VALUES (v_new_item_id, 'item_created_from_orphan', p_actor_email,
            jsonb_build_object('document_id', p_document_id, 'apply_report', v_apply_report));

    RETURN v_apply_report || jsonb_build_object('item_id', v_new_item_id);
END; $$;

REVOKE ALL ON FUNCTION public.create_item_from_orphan(INTEGER, VARCHAR, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_item_from_orphan(INTEGER, VARCHAR, BOOLEAN) TO authenticated;


-- -----------------------------------------------------------------------------
-- 6. Make sure the orphan tracks are reachable through realtime
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
          AND tablename = 'compliance_document_import_batches'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.compliance_document_import_batches;
    END IF;
END $$;