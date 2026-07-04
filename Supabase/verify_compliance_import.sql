-- =============================================================================
-- Promed: Compliance Import + RLS — verification + one-time safety net
-- =============================================================================
-- Run this in your Supabase SQL Editor if importing the rest of the migration
-- files isn't convenient. It is fully idempotent and recreates the smallest
-- possible subset that gets `/compliance/import` working end to end.
--
-- What this script does:
--   1. Adds the orphan columns (intended_title, intended_authority, is_orphan)
--      if they don't exist yet.
--   2. Loosens item_id from NOT NULL so orphan rows can live.
--   3. Re-creates the four Phase-1 RLS policies on compliance_item_documents
--      so orphan rows are readable/insertable/updatable/deletable.
--   4. Re-creates the realtime publication for the new tables.
--
-- It does NOT touch any other Phase-1 / Phase-2 table or trigger, so it's safe
-- to run on an existing project at any time.
-- =============================================================================


-- 1. Orphan columns on compliance_item_documents ----------------------------
ALTER TABLE public.compliance_item_documents
    ALTER COLUMN item_id DROP NOT NULL;

ALTER TABLE public.compliance_item_documents
    ADD COLUMN IF NOT EXISTS is_orphan           BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS intended_authority  VARCHAR(200),
    ADD COLUMN IF NOT EXISTS intended_title      VARCHAR(300);

CREATE INDEX IF NOT EXISTS idx_compliance_item_documents_orphan
    ON public.compliance_item_documents(is_orphan)
    WHERE is_orphan = TRUE;


-- 2. Batches table ---------------------------------------------------------
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


-- 3. RLS fix on compliance_item_documents -----------------------------------
DROP POLICY IF EXISTS "compliance_item_documents_select" ON public.compliance_item_documents;
CREATE POLICY "compliance_item_documents_select" ON public.compliance_item_documents
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.compliance_items i
                WHERE i.id = item_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
        OR (is_orphan = TRUE AND (user_id = auth.uid() OR user_id IS NULL))
    );

DROP POLICY IF EXISTS "compliance_item_documents_insert" ON public.compliance_item_documents;
CREATE POLICY "compliance_item_documents_insert" ON public.compliance_item_documents
    FOR INSERT WITH CHECK (
        (item_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.compliance_items i
            WHERE i.id = item_id AND (i.user_id = auth.uid() OR i.user_id IS NULL)
        ))
        OR (item_id IS NULL AND is_orphan = TRUE AND (user_id = auth.uid() OR user_id IS NULL))
    );

DROP POLICY IF EXISTS "compliance_item_documents_update" ON public.compliance_item_documents;
CREATE POLICY "compliance_item_documents_update" ON public.compliance_item_documents
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.compliance_items i
                WHERE i.id = item_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
        OR (is_orphan = TRUE AND (user_id = auth.uid() OR user_id IS NULL))
    );

DROP POLICY IF EXISTS "compliance_item_documents_delete" ON public.compliance_item_documents;
CREATE POLICY "compliance_item_documents_delete" ON public.compliance_item_documents
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM public.compliance_items i
                WHERE i.id = item_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
        OR (is_orphan = TRUE AND (user_id = auth.uid() OR user_id IS NULL))
    );


-- 4. Realtime publication (defensive) --------------------------------------
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


-- 5. Skip timeline events for orphan documents (item_id IS NULL) -----------
-- Phase-1 log_compliance_document_event() always wrote compliance_item_events
-- on INSERT. With orphan imports item_id is NULL, which violates NOT NULL on
-- compliance_item_events.item_id and rolls back the whole upload insert.
CREATE OR REPLACE FUNCTION log_compliance_document_event()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
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


-- 6. Audit-log triggers must bypass RLS ------------------------------------
-- The compliance_item_events table is an append-only audit log written only by
-- triggers. Under the caller's RLS the trigger INSERT can fail with
-- "new row violates row-level security policy for table compliance_item_events"
-- (e.g. when the pipeline advances a document to waiting_for_review).
-- Marking the trigger functions SECURITY DEFINER makes them run as the owner
-- (postgres) so the audit insert always succeeds. auth.uid() still resolves
-- from the JWT, so ownership logic elsewhere is unaffected.
ALTER FUNCTION public.log_compliance_document_event() SECURITY DEFINER;
ALTER FUNCTION public.log_compliance_item_event() SECURITY DEFINER;

-- Recreate the document extraction event trigger with BOTH fixes:
--   1. SECURITY DEFINER  -> audit insert bypasses the caller's RLS
--   2. NULL item_id guard -> orphan documents (no parent item) never attempt to
--      write compliance_item_events, which would violate the NOT NULL on item_id.
-- An older deployment may have this function without the guard; recreating it
-- here guarantees the correct version regardless of what is currently installed.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'trg_log_document_extraction_event'
    ) THEN
        CREATE OR REPLACE FUNCTION public.trg_log_document_extraction_event()
        RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $fn$
        BEGIN
            IF NEW.item_id IS NULL THEN
                RETURN NEW; -- orphan document: no parent item, skip timeline
            END IF;
            IF TG_OP = 'UPDATE' AND OLD.processing_status IS DISTINCT FROM NEW.processing_status THEN
                IF NEW.processing_status = 'waiting_for_review' AND OLD.processing_status <> 'waiting_for_review' THEN
                    INSERT INTO public.compliance_item_events (item_id, event_type, actor_email, payload)
                    VALUES (NEW.item_id, 'document_extracted', NULL,
                            jsonb_build_object(
                                'document_id', NEW.id,
                                'file_name',    NEW.file_name,
                                'document_type', NEW.document_type,
                                'confidence',   NEW.confidence_score
                            ));
                ELSIF NEW.review_status IS DISTINCT FROM OLD.review_status
                      AND NEW.review_status IN ('approved','rejected','edited') THEN
                    INSERT INTO public.compliance_item_events (item_id, event_type, actor_email, payload)
                    VALUES (NEW.item_id, 'document_reviewed', NEW.reviewed_by_email,
                            jsonb_build_object(
                                'document_id', NEW.id,
                                'file_name',    NEW.file_name,
                                'review_status', NEW.review_status
                            ));
                ELSIF NEW.processing_status = 'failed' AND OLD.processing_status <> 'failed' THEN
                    INSERT INTO public.compliance_item_events (item_id, event_type, actor_email, payload)
                    VALUES (NEW.item_id, 'document_processing_failed', NULL,
                            jsonb_build_object(
                                'document_id', NEW.id,
                                'file_name',    NEW.file_name,
                                'errors',       NEW.processing_errors
                            ));
                END IF;
            END IF;
            RETURN NEW;
        END;
        $fn$;
    END IF;
END $$;
