-- =============================================================================
-- Promed: Compliance Module — Storage bucket for compliance documents
-- =============================================================================
-- Run this after supabase_compliance.sql.
-- Creates the 'compliance-documents' bucket and RLS policies on
-- storage.objects so each user can only manage their own files.
-- Path convention: {user_id}/{item_id}/{file_name}
-- =============================================================================

-- Create the private bucket if it doesn't exist.
INSERT INTO storage.buckets (id, name, public)
VALUES ('compliance-documents', 'compliance-documents', FALSE)
ON CONFLICT (id) DO NOTHING;


-- Path-based RLS: the first segment of the object name MUST be the owner's uid.
CREATE POLICY "compliance_documents_select" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'compliance-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "compliance_documents_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'compliance-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "compliance_documents_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
        bucket_id = 'compliance-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
        bucket_id = 'compliance-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "compliance_documents_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'compliance-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );