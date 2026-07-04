-- =============================================================================
-- Promed: Compliance Document Intelligence
-- =============================================================================
-- Run this AFTER supabase_compliance.sql + supabase_compliance_storage.sql.
-- Pure additive changes; nothing in the existing compliance files is altered.
--
-- Adds:
--   - 16 new columns on compliance_item_documents     (AI + review state)
--   - 2 generated tsvector columns + GIN index        (search)
--   - 3 new tables                                    (links, tags, tag assignments)
--   - 5 RPC functions                                 (enqueue/advance/review/restore/apply)
--   - 1 selection RPC                                 (next_pending_document)
--   - 2 triggers                                      (auto-enqueue, log extraction events)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Extend compliance_item_documents
-- -----------------------------------------------------------------------------
ALTER TABLE public.compliance_item_documents
    ADD COLUMN IF NOT EXISTS processing_status      VARCHAR(30)  NOT NULL DEFAULT 'uploaded',
    ADD COLUMN IF NOT EXISTS confidence_score       NUMERIC(4,3),
    ADD COLUMN IF NOT EXISTS extracted_text         TEXT,
    ADD COLUMN IF NOT EXISTS extracted_metadata     JSONB        NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS ai_summary             TEXT,
    ADD COLUMN IF NOT EXISTS document_type          VARCHAR(50),
    ADD COLUMN IF NOT EXISTS language               VARCHAR(10),
    ADD COLUMN IF NOT EXISTS processing_errors      JSONB        NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS reviewed_by_email      VARCHAR(200),
    ADD COLUMN IF NOT EXISTS reviewed_at            TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS review_status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS current_version_id     INTEGER REFERENCES public.compliance_item_documents(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS is_current_version     BOOLEAN      NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS processing_attempts    INTEGER      NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS processing_started_at  TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS processing_completed_at TIMESTAMP WITH TIME ZONE;

-- CHECK constraints (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'compliance_item_documents_processing_status_check'
    ) THEN
        ALTER TABLE public.compliance_item_documents
            ADD CONSTRAINT compliance_item_documents_processing_status_check
            CHECK (processing_status IN (
                'uploaded','queued','ocr_processing','text_extracted',
                'classified','metadata_extracted','waiting_for_review',
                'approved','stored','failed'
            ));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'compliance_item_documents_review_status_check'
    ) THEN
        ALTER TABLE public.compliance_item_documents
            ADD CONSTRAINT compliance_item_documents_review_status_check
            CHECK (review_status IN ('pending','approved','rejected','edited'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'compliance_item_documents_confidence_range_check'
    ) THEN
        ALTER TABLE public.compliance_item_documents
            ADD CONSTRAINT compliance_item_documents_confidence_range_check
            CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1));
    END IF;
END $$;

-- Indexes to make processing dashboard queries fast.
CREATE INDEX IF NOT EXISTS idx_compliance_item_documents_status
    ON public.compliance_item_documents(processing_status);
CREATE INDEX IF NOT EXISTS idx_compliance_item_documents_review
    ON public.compliance_item_documents(review_status);
CREATE INDEX IF NOT EXISTS idx_compliance_item_documents_type
    ON public.compliance_item_documents(document_type);


-- -----------------------------------------------------------------------------
-- 2. Full-text search vector (generated, GIN-indexed)
-- -----------------------------------------------------------------------------
ALTER TABLE public.compliance_item_documents
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(file_name,         '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(extracted_text,    '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(extracted_metadata::text, '')), 'C') ||
        setweight(to_tsvector('simple', coalesce(ai_summary,         '')), 'C')
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_compliance_item_documents_search
    ON public.compliance_item_documents USING GIN (search_vector);


-- -----------------------------------------------------------------------------
-- 3. Polymorphic document-link table
--    entity_type ∈ { compliance_item, authority, product, supplier, machine, employee }
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_document_links (
    id           SERIAL PRIMARY KEY,
    document_id  INTEGER NOT NULL REFERENCES public.compliance_item_documents(id) ON DELETE CASCADE,
    entity_type  VARCHAR(30) NOT NULL CHECK (entity_type IN (
        'compliance_item','authority','product','supplier','machine','employee'
    )),
    entity_id    INTEGER NOT NULL,
    link_role    VARCHAR(30) NOT NULL DEFAULT 'related',
    user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uniq_compliance_document_link UNIQUE (document_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_compliance_document_links_doc
    ON public.compliance_document_links(document_id);
CREATE INDEX IF NOT EXISTS idx_compliance_document_links_entity
    ON public.compliance_document_links(entity_type, entity_id);

DROP TRIGGER IF EXISTS update_compliance_document_links_updated_at
    ON public.compliance_document_links;
CREATE TRIGGER update_compliance_document_links_updated_at
    BEFORE UPDATE ON public.compliance_document_links
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- -----------------------------------------------------------------------------
-- 4. Document tags
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_document_tags (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(50) NOT NULL,
    user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uniq_compliance_document_tag_name UNIQUE (name, user_id)
);

CREATE INDEX IF NOT EXISTS idx_compliance_document_tags_user_id
    ON public.compliance_document_tags(user_id);

DROP TRIGGER IF EXISTS update_compliance_document_tags_updated_at
    ON public.compliance_document_tags;
CREATE TRIGGER update_compliance_document_tags_updated_at
    BEFORE UPDATE ON public.compliance_document_tags
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.compliance_document_tag_assignments (
    document_id  INTEGER NOT NULL REFERENCES public.compliance_item_documents(id) ON DELETE CASCADE,
    tag_id       INTEGER NOT NULL REFERENCES public.compliance_document_tags(id) ON DELETE CASCADE,
    user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (document_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_compliance_document_tag_assignments_tag
    ON public.compliance_document_tag_assignments(tag_id);


-- =============================================================================
-- 5. Row Level Security
-- =============================================================================
ALTER TABLE public.compliance_document_links           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_document_tags            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_document_tag_assignments ENABLE ROW LEVEL SECURITY;

-- Links: parent-derived from the document (via document → item → user).
DROP POLICY IF EXISTS "compliance_document_links_select" ON public.compliance_document_links;
CREATE POLICY "compliance_document_links_select" ON public.compliance_document_links
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.compliance_item_documents d
                JOIN  public.compliance_items i ON i.id = d.item_id
                WHERE d.id = document_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );
DROP POLICY IF EXISTS "compliance_document_links_insert" ON public.compliance_document_links;
CREATE POLICY "compliance_document_links_insert" ON public.compliance_document_links
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.compliance_item_documents d
                JOIN  public.compliance_items i ON i.id = d.item_id
                WHERE d.id = document_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );
DROP POLICY IF EXISTS "compliance_document_links_update" ON public.compliance_document_links;
CREATE POLICY "compliance_document_links_update" ON public.compliance_document_links
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.compliance_item_documents d
                JOIN  public.compliance_items i ON i.id = d.item_id
                WHERE d.id = document_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );
DROP POLICY IF EXISTS "compliance_document_links_delete" ON public.compliance_document_links;
CREATE POLICY "compliance_document_links_delete" ON public.compliance_document_links
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM public.compliance_item_documents d
                JOIN  public.compliance_items i ON i.id = d.item_id
                WHERE d.id = document_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );

-- Tags: own + shared system-wide is_system rows would belong here;
-- for now scope all tags to the owner.
DROP POLICY IF EXISTS "compliance_document_tags_select" ON public.compliance_document_tags;
CREATE POLICY "compliance_document_tags_select" ON public.compliance_document_tags
    FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
DROP POLICY IF EXISTS "compliance_document_tags_insert" ON public.compliance_document_tags;
CREATE POLICY "compliance_document_tags_insert" ON public.compliance_document_tags
    FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
DROP POLICY IF EXISTS "compliance_document_tags_update" ON public.compliance_document_tags;
CREATE POLICY "compliance_document_tags_update" ON public.compliance_document_tags
    FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);
DROP POLICY IF EXISTS "compliance_document_tags_delete" ON public.compliance_document_tags;
CREATE POLICY "compliance_document_tags_delete" ON public.compliance_document_tags
    FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);

-- Tag assignments: parent-derived from the document.
DROP POLICY IF EXISTS "compliance_document_tag_assignments_select" ON public.compliance_document_tag_assignments;
CREATE POLICY "compliance_document_tag_assignments_select" ON public.compliance_document_tag_assignments
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.compliance_item_documents d
                JOIN  public.compliance_items i ON i.id = d.item_id
                WHERE d.id = document_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );
DROP POLICY IF EXISTS "compliance_document_tag_assignments_insert" ON public.compliance_document_tag_assignments;
CREATE POLICY "compliance_document_tag_assignments_insert" ON public.compliance_document_tag_assignments
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.compliance_item_documents d
                JOIN  public.compliance_items i ON i.id = d.item_id
                WHERE d.id = document_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );
DROP POLICY IF EXISTS "compliance_document_tag_assignments_update" ON public.compliance_document_tag_assignments;
CREATE POLICY "compliance_document_tag_assignments_update" ON public.compliance_document_tag_assignments
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.compliance_item_documents d
                JOIN  public.compliance_items i ON i.id = d.item_id
                WHERE d.id = document_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );
DROP POLICY IF EXISTS "compliance_document_tag_assignments_delete" ON public.compliance_document_tag_assignments;
CREATE POLICY "compliance_document_tag_assignments_delete" ON public.compliance_document_tag_assignments
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM public.compliance_item_documents d
                JOIN  public.compliance_items i ON i.id = d.item_id
                WHERE d.id = document_id AND (i.user_id = auth.uid() OR i.user_id IS NULL))
    );

-- Documents themselves: add columns are covered by the existing
-- compliance_item_documents_* policies (they reference the table, not specific columns).


-- =============================================================================
-- 6. Pipeline worker functions
-- =============================================================================

-- Mark a document as queued.
CREATE OR REPLACE FUNCTION public.enqueue_document(p_document_id INTEGER)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE public.compliance_item_documents
    SET processing_status     = 'queued',
        processing_attempts   = processing_attempts + 1,
        processing_started_at = NOW(),
        processing_errors     = '[]'::jsonb
    WHERE id = p_document_id;
END; $$;

-- Advance state to a new step, optionally setting extracted fields / errors.
CREATE OR REPLACE FUNCTION public.advance_document_processing(
    p_document_id        INTEGER,
    p_next_status        VARCHAR,
    p_extracted_text     TEXT     DEFAULT NULL,
    p_extracted_metadata JSONB    DEFAULT NULL,
    p_ai_summary         TEXT     DEFAULT NULL,
    p_document_type      VARCHAR  DEFAULT NULL,
    p_language           VARCHAR  DEFAULT NULL,
    p_confidence         NUMERIC  DEFAULT NULL,
    p_error              TEXT     DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    cur_status VARCHAR(30);
BEGIN
    SELECT processing_status INTO cur_status
        FROM public.compliance_item_documents WHERE id = p_document_id;
    IF cur_status IS NULL THEN RETURN; END IF;

    -- Terminal states are sticky.
    IF cur_status IN ('approved','stored') AND p_next_status NOT IN ('approved','stored') THEN
        RAISE EXCEPTION 'cannot move document % from terminal state % to %', p_document_id, cur_status, p_next_status;
    END IF;

    UPDATE public.compliance_item_documents
    SET processing_status        = p_next_status,
        extracted_text           = COALESCE(p_extracted_text,     extracted_text),
        extracted_metadata       = COALESCE(p_extracted_metadata, extracted_metadata),
        ai_summary               = COALESCE(p_ai_summary,         ai_summary),
        document_type            = COALESCE(p_document_type,      document_type),
        language                 = COALESCE(p_language,           language),
        confidence_score         = COALESCE(p_confidence,         confidence_score),
        processing_errors        = CASE WHEN p_error IS NULL THEN processing_errors
                                       ELSE processing_errors || jsonb_build_array(p_error) END,
        processing_completed_at  = CASE
            WHEN p_next_status IN ('approved','stored','failed') THEN NOW()
            ELSE processing_completed_at
        END
    WHERE id = p_document_id;
END; $$;

-- Lock in a review decision.
CREATE OR REPLACE FUNCTION public.review_document(
    p_document_id     INTEGER,
    p_status          VARCHAR,
    p_reviewer_email  VARCHAR
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_status NOT IN ('pending','approved','rejected','edited') THEN
        RAISE EXCEPTION 'invalid review status %', p_status;
    END IF;
    UPDATE public.compliance_item_documents
    SET review_status      = p_status,
        reviewed_by_email  = p_reviewer_email,
        reviewed_at        = NOW(),
        -- 'approved' moves the doc into the final stored state.
        processing_status  = CASE WHEN p_status = 'approved' THEN 'stored' ELSE processing_status END
    WHERE id = p_document_id;
END; $$;

-- Restore an older version: clone the source row as a NEW version that becomes
-- the new current head. Previous head is marked is_current_version = FALSE.
CREATE OR REPLACE FUNCTION public.restore_document_version(p_document_id INTEGER, p_version_id INTEGER)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    src        RECORD;
    head_id    INTEGER;
    new_version INTEGER;
    new_id     INTEGER;
BEGIN
    SELECT * INTO src FROM public.compliance_item_documents WHERE id = p_version_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'version % not found', p_version_id; END IF;

    -- Find current head in the same chain (same item_id + file_name).
    SELECT id INTO head_id FROM public.compliance_item_documents
        WHERE item_id = src.item_id AND file_name = src.file_name AND is_current_version = TRUE
        LIMIT 1;

    SELECT COALESCE(MAX(version), 0) + 1 INTO new_version
        FROM public.compliance_item_documents
        WHERE item_id = src.item_id AND file_name = src.file_name;

    IF head_id IS NOT NULL THEN
        UPDATE public.compliance_item_documents SET is_current_version = FALSE WHERE id = head_id;
    END IF;

    INSERT INTO public.compliance_item_documents (
        item_id, file_name, storage_path, bucket, mime_type, size_bytes, version,
        previous_version_id, uploaded_by_email, notes, user_id, is_current_version,
        extracted_text, extracted_metadata, ai_summary, document_type, language, confidence_score
    ) VALUES (
        src.item_id, src.file_name, src.storage_path, src.bucket, src.mime_type, src.size_bytes,
        new_version, COALESCE(head_id, src.previous_version_id),
        COALESCE(src.uploaded_by_email, p_document_id::text),
        'restored from v' || src.version,
        src.user_id, TRUE,
        src.extracted_text, src.extracted_metadata, src.ai_summary,
        src.document_type, src.language, src.confidence_score
    ) RETURNING id INTO new_id;

    IF head_id IS NOT NULL THEN
        UPDATE public.compliance_item_documents SET current_version_id = new_id WHERE id = head_id;
    END IF;
    RETURN new_id;
END; $$;

-- Worker picks the next pending document. Frontend polls this via POST /rest/v1/rpc/.
CREATE OR REPLACE FUNCTION public.next_pending_document()
RETURNS SETOF public.compliance_item_documents
LANGUAGE sql STABLE
AS $$
    SELECT *
    FROM public.compliance_item_documents
    WHERE processing_status IN ('queued','ocr_processing','text_extracted',
                                'classified','metadata_extracted','waiting_for_review')
      AND (processing_started_at IS NULL OR processing_started_at < NOW() - INTERVAL '5 seconds')
    ORDER BY processing_started_at ASC NULLS FIRST, created_at ASC
    LIMIT 1;
$$;


-- Propagate extracted values onto the parent compliance_item, stage the
-- authority link, and record the event — all in one atomic transaction.
--
-- Field whitelist below maps a metadata key (output of any future AI) to a
-- concrete compliance_items column. Only NULL fields are filled, so a human
-- hand-edit is never overwritten. Pass p_authoritative = TRUE to allow
-- overwriting (use only for batch re-extraction; the UI never does).
CREATE OR REPLACE FUNCTION public.apply_extracted_metadata(
    p_document_id  INTEGER,
    p_actor_email  VARCHAR,
    p_authoritative BOOLEAN DEFAULT FALSE
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_item_id            INTEGER;
    v_metadata           JSONB;
    v_title              TEXT;
    v_authority_name     TEXT;
    v_authority_id_new   INTEGER;
    v_reference_number   TEXT;
    v_issue_date_str     TEXT;
    v_expiry_date_str    TEXT;
    v_renewal_period     NUMERIC;
    v_description        TEXT;
    v_reference_in_item  VARCHAR(200);
    v_issue_in_item      DATE;
    v_expiry_in_item     DATE;
    v_renewal_in_item    INTEGER;
    v_description_in     TEXT;
    v_title_in           VARCHAR(300);
    v_authority_in       INTEGER;
    v_diag               JSONB := '{"applied":[],"skipped":[],"linked_authority_id":null,"errors":[],"actor_email":null}'::jsonb;
    v_link_existed       BOOLEAN := FALSE;
    v_doc_name           TEXT;
BEGIN
    -- Read the document once.
    SELECT item_id, extracted_metadata, file_name
      INTO v_item_id, v_metadata, v_doc_name
    FROM public.compliance_item_documents
    WHERE id = p_document_id;
    IF v_item_id IS NULL THEN
        RETURN jsonb_build_object('errors', ARRAY['document_not_found']);
    END IF;

    -- Ownership guard. SECURITY DEFINER still trusts the function owner, but
    -- we double-check here so a leaked token can't apply to someone else's row.
    IF NOT EXISTS (
        SELECT 1 FROM public.compliance_items WHERE id = v_item_id AND (user_id = auth.uid() OR user_id IS NULL)
    ) THEN
        RETURN jsonb_build_object('errors', ARRAY['not_authorized']);
    END IF;

    IF v_metadata IS NULL THEN v_metadata := '{}'::jsonb; END IF;

    -- Pull candidate values (cast carefully, treat empty strings as null).
    v_title           := nullif(coalesce(v_metadata->>'title',              ''), '');
    v_authority_name  := nullif(coalesce(v_metadata->>'authority_name',     ''), '');
    v_reference_number:= nullif(coalesce(v_metadata->>'reference_number',   ''), '');
    v_issue_date_str  := nullif(coalesce(v_metadata->>'issue_date',         ''), '');
    v_expiry_date_str := nullif(coalesce(v_metadata->>'expiry_date',        ''), '');
    v_renewal_period  := nullif(coalesce(v_metadata->>'renewal_period_days',''), '')::NUMERIC;
    v_description     := nullif(coalesce(v_metadata->>'document_type',      ''), '');  -- best raw description we have

    SELECT title, authority_id, reference_number, issue_date, expiry_date, renewal_period_days, description
      INTO v_title_in, v_authority_in, v_reference_in_item, v_issue_in_item, v_expiry_in_item, v_renewal_in_item, v_description_in
    FROM public.compliance_items WHERE id = v_item_id;

    -- Helper block: decide which columns to update.
    -- For each candidate, only update if (NULL) OR (authoritative override was requested).
    IF v_authority_name IS NOT NULL THEN
        -- Resolve or create the authority. Match by case-insensitive name within the same user scope.
        SELECT id INTO v_authority_id_new
        FROM public.compliance_authorities
        WHERE lower(name) = lower(v_authority_name)
        ORDER BY id LIMIT 1;
        IF v_authority_id_new IS NULL THEN
            INSERT INTO public.compliance_authorities (name, user_id)
            VALUES (v_authority_name, auth.uid())
            RETURNING id INTO v_authority_id_new;
        END IF;
        IF v_authority_in IS NULL OR p_authoritative THEN
            UPDATE public.compliance_items SET authority_id = v_authority_id_new WHERE id = v_item_id;
            v_diag := v_diag || jsonb_build_object('applied',
                v_diag->'applied' || jsonb_build_object('authority_id', v_authority_id_new));
        ELSE
            v_diag := v_diag || jsonb_build_object('skipped',
                v_diag->'skipped' || jsonb_build_object('authority_id', 'already_set'));
        END IF;
    END IF;

    IF v_title IS NOT NULL AND (v_title_in IS NULL OR p_authoritative) THEN
        UPDATE public.compliance_items SET title = v_title WHERE id = v_item_id;
        v_diag := v_diag || jsonb_build_object('applied', v_diag->'applied' || jsonb_build_object('title', v_title));
    ELSIF v_title IS NOT NULL THEN
        v_diag := v_diag || jsonb_build_object('skipped', v_diag->'skipped' || jsonb_build_object('title', 'already_set'));
    END IF;

    IF v_reference_number IS NOT NULL AND (v_reference_in_item IS NULL OR p_authoritative) THEN
        UPDATE public.compliance_items SET reference_number = v_reference_number WHERE id = v_item_id;
        v_diag := v_diag || jsonb_build_object('applied', v_diag->'applied' || jsonb_build_object('reference_number', v_reference_number));
    ELSIF v_reference_number IS NOT NULL THEN
        v_diag := v_diag || jsonb_build_object('skipped', v_diag->'skipped' || jsonb_build_object('reference_number', 'already_set'));
    END IF;

    IF v_issue_date_str IS NOT NULL AND (v_issue_in_item IS NULL OR p_authoritative) THEN
        BEGIN
            UPDATE public.compliance_items SET issue_date = v_issue_date_str::date WHERE id = v_item_id;
            v_diag := v_diag || jsonb_build_object('applied', v_diag->'applied' || jsonb_build_object('issue_date', v_issue_date_str));
        EXCEPTION WHEN others THEN
            v_diag := v_diag || jsonb_build_object('skipped', v_diag->'skipped' || jsonb_build_object('issue_date', 'bad_date_format'));
        END;
    END IF;

    IF v_expiry_date_str IS NOT NULL AND (v_expiry_in_item IS NULL OR p_authoritative) THEN
        BEGIN
            UPDATE public.compliance_items SET expiry_date = v_expiry_date_str::date WHERE id = v_item_id;
            v_diag := v_diag || jsonb_build_object('applied', v_diag->'applied' || jsonb_build_object('expiry_date', v_expiry_date_str));
        EXCEPTION WHEN others THEN
            v_diag := v_diag || jsonb_build_object('skipped', v_diag->'skipped' || jsonb_build_object('expiry_date', 'bad_date_format'));
        END;
    END IF;

    IF v_renewal_period IS NOT NULL AND (v_renewal_in_item IS NULL OR p_authoritative) THEN
        BEGIN
            UPDATE public.compliance_items SET renewal_period_days = v_renewal_period::int WHERE id = v_item_id;
            v_diag := v_diag || jsonb_build_object('applied', v_diag->'applied' || jsonb_build_object('renewal_period_days', v_renewal_period::int));
        EXCEPTION WHEN others THEN
            v_diag := v_diag || jsonb_build_object('skipped', v_diag->'skipped' || jsonb_build_object('renewal_period_days', 'invalid_number'));
        END;
    END IF;

    -- Stage the document → authority link (idempotent on the unique index).
    IF v_authority_id_new IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.compliance_document_links
            WHERE document_id = p_document_id AND entity_type = 'authority' AND entity_id = v_authority_id_new
        ) INTO v_link_existed;
        IF NOT v_link_existed THEN
            INSERT INTO public.compliance_document_links (document_id, entity_type, entity_id, link_role, user_id)
            VALUES (p_document_id, 'authority', v_authority_id_new, 'primary', auth.uid())
            ON CONFLICT DO NOTHING;
        END IF;
        v_diag := v_diag || jsonb_build_object('linked_authority_id', v_authority_id_new);
    END IF;

    -- Record the event (only if something actually happened).
    IF jsonb_array_length(v_diag->'applied') > 0 OR (v_diag ? 'linked_authority_id') THEN
        INSERT INTO public.compliance_item_events (item_id, event_type, actor_email, payload)
        VALUES (
            v_item_id,
            'extraction_applied',
            p_actor_email,
            jsonb_build_object(
                'document_id', p_document_id,
                'file_name',   v_doc_name,
                'applied',     v_diag->'applied',
                'linked_authority_id', v_diag->'linked_authority_id'
            )
        );
    END IF;

    v_diag := v_diag || jsonb_build_object('actor_email', p_actor_email);
    RETURN v_diag;
END; $$;

-- Grant execute to authenticated users (RLS still enforced through the row check above).
REVOKE ALL ON FUNCTION public.apply_extracted_metadata(INTEGER, VARCHAR, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_extracted_metadata(INTEGER, VARCHAR, BOOLEAN) TO authenticated;


-- =============================================================================
-- 7. Triggers
-- =============================================================================

-- Auto-enqueue new (non-versioned) uploads. Orphan rows (item_id IS NULL)
-- are deliberately skipped — they will only be queued once the user links or
-- creates a compliance_item from them.
CREATE OR REPLACE FUNCTION public.trg_enqueue_new_document()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.previous_version_id IS NULL
       AND NEW.processing_status = 'uploaded'
       AND NEW.item_id IS NOT NULL
    THEN
        PERFORM public.enqueue_document(NEW.id);
    END IF;
    RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_compliance_doc_enqueue ON public.compliance_item_documents;
CREATE TRIGGER trg_compliance_doc_enqueue
    AFTER INSERT ON public.compliance_item_documents
    FOR EACH ROW EXECUTE FUNCTION public.trg_enqueue_new_document();

-- Log a 'document_extracted' event when status moves into waiting_for_review.
-- Orphan rows (item_id IS NULL) are skipped so we never write events that
-- can't be attached to a parent item.
CREATE OR REPLACE FUNCTION public.trg_log_document_extraction_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF NEW.item_id IS NULL THEN
        RETURN NEW;
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
END; $$;

DROP TRIGGER IF EXISTS trg_log_document_extraction_event ON public.compliance_item_documents;
CREATE TRIGGER trg_log_document_extraction_event
    AFTER UPDATE ON public.compliance_item_documents
    FOR EACH ROW EXECUTE FUNCTION public.trg_log_document_extraction_event();


-- =============================================================================
-- 8. Realtime (frontend subscribes via postgres_changes regardless, but include
--    the new tables in the publication so Supabase realtime keeps them in sync)
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
          AND tablename = 'compliance_document_links'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.compliance_document_links;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
          AND tablename = 'compliance_document_tags'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.compliance_document_tags;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
          AND tablename = 'compliance_document_tag_assignments'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.compliance_document_tag_assignments;
    END IF;
END $$;
-- compliance_item_documents is intentionally NOT added here; we already subscribe
-- from the frontend via postgres_changes which is enabled by default for the table.