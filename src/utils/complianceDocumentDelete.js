// Delete a compliance document row and its storage object.
import { supabase } from '../lib/supabase'

const DEFAULT_BUCKET = 'compliance-documents'

export async function deleteComplianceDocument(doc) {
  if (!doc?.id) throw new Error('Document id is required')

  const bucket = doc.bucket || DEFAULT_BUCKET
  if (doc.storage_path) {
    try {
      await supabase.storage.from(bucket).remove([doc.storage_path])
    } catch {
      // Storage may already be gone — continue with DB delete.
    }
  }

  const { error } = await supabase
    .from('compliance_item_documents')
    .delete()
    .eq('id', doc.id)

  if (error) throw error
}

export async function deleteComplianceDocuments(docs) {
  const list = Array.isArray(docs) ? docs : []
  const results = await Promise.allSettled(list.map((d) => deleteComplianceDocument(d)))
  const failed = results.filter((r) => r.status === 'rejected')
  if (failed.length > 0) {
    const msg = failed.map((r) => r.reason?.message || 'Delete failed').join('; ')
    throw new Error(msg)
  }
  return list.length
}
