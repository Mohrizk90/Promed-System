// Shared helpers for the compliance document import / orphan flow.
// Queries intentionally avoid optional import-migration columns
// (intended_title, intended_authority, is_orphan) so the UI loads even
// before Supabase/supabase_compliance_import.sql has been applied.

export const ORPHAN_DOC_LIST_SELECT =
  'id, file_name, mime_type, size_bytes, processing_status, review_status, created_at, extracted_metadata'

export const ORPHAN_DOC_DETAIL_SELECT =
  'id, item_id, file_name, storage_path, bucket, mime_type, processing_status, review_status, confidence_score, extracted_text, extracted_metadata, ai_summary'

/** True when PostgREST/Postgres reports missing import-migration schema. */
export function isImportMigrationError(err) {
  const msg = `${err?.message || ''} ${err?.details || ''} ${err?.hint || ''}`.toLowerCase()
  return (
    msg.includes('intended_title')
    || msg.includes('intended_authority')
    || msg.includes('is_orphan')
    || msg.includes('create_item_from_orphan')
    || msg.includes('link_orphan_to_item')
    || (msg.includes('item_id') && msg.includes('null') && msg.includes('violates'))
  )
}

export function parseExtractedMetadata(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}
