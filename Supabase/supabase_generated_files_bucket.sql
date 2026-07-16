-- =============================================================================
-- Promed: Private generated-files storage bucket
-- =============================================================================
-- Creates the private bucket used for generated ERP and agent files. Each
-- authenticated owner reads objects whose first folder segment is their UUID;
-- the service role creates, updates, and deletes files and bypasses storage
-- object RLS, so separate service-role write policies are unnecessary.
-- Example queries:
--   SELECT name FROM storage.objects WHERE bucket_id = 'generated-files';
--   SELECT * FROM storage.buckets WHERE id = 'generated-files';
-- =============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('generated-files', 'generated-files', FALSE)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "owner reads own files" ON storage.objects;
CREATE POLICY "owner reads own files"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'generated-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
);
