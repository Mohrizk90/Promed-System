// Hook: fetch + subscribe to compliance documents with their parent item,
// links and tags. Used by the library tab + the review screen.
//
// Search runs client-side (the search_vector column is in the DB for future
// full-text indexing; today we filter 500 rows in memory for instant UI).
import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'

const DOC_SELECT = `
  *,
  compliance_items:item_id ( id, title, authority_id, compliance_authorities:authority_id (id, name, color) ),
  compliance_document_links ( id, entity_type, entity_id, link_role ),
  compliance_document_tag_assignments ( tag_id, compliance_document_tags ( id, name ) )
`

function tagNames(doc) {
  return (doc.compliance_document_tag_assignments || [])
    .map((a) => a.compliance_document_tags?.name)
    .filter(Boolean)
}

function matchesQuery(doc, q) {
  if (!q) return true
  if ((doc.file_name || '').toLowerCase().includes(q)) return true
  if ((doc.extracted_text || '').toLowerCase().includes(q)) return true
  if ((doc.ai_summary || '').toLowerCase().includes(q)) return true
  if (doc.compliance_items?.title?.toLowerCase().includes(q)) return true
  if (doc.compliance_items?.compliance_authorities?.name?.toLowerCase().includes(q)) return true
  try {
    const meta = typeof doc.extracted_metadata === 'string'
      ? JSON.parse(doc.extracted_metadata)
      : doc.extracted_metadata
    const flat = Object.values(meta || {}).filter(Boolean).join(' ').toLowerCase()
    if (flat.includes(q)) return true
  } catch (_) { /* ignore */ }
  return tagNames(doc).some((n) => n.toLowerCase().includes(q))
}

export function useComplianceDocuments({ filters = {}, onlyItemId = null } = {}) {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchDocs = useCallback(async () => {
    try {
      setLoading(true)
      let q = supabase
        .from('compliance_item_documents')
        .select(DOC_SELECT)
        .order('created_at', { ascending: false })
        .limit(500)

      if (onlyItemId) q = q.eq('item_id', onlyItemId)

      if (filters.processingStatus && filters.processingStatus !== 'all') {
        q = q.eq('processing_status', filters.processingStatus)
      }
      if (filters.reviewStatus && filters.reviewStatus !== 'all') {
        q = q.eq('review_status', filters.reviewStatus)
      }
      if (filters.documentType && filters.documentType !== 'all') {
        q = q.eq('document_type', filters.documentType)
      }
      if (filters.dateFrom) q = q.gte('created_at', filters.dateFrom)
      if (filters.dateTo)   q = q.lte('created_at', `${filters.dateTo}T23:59:59`)

      const { data, error } = await q
      if (error) throw error
      setDocs(data || [])
    } finally {
      setLoading(false)
    }
  }, [onlyItemId, filters.processingStatus, filters.reviewStatus, filters.documentType, filters.dateFrom, filters.dateTo])

  useEffect(() => {
    fetchDocs()
    const ch = supabase
      .channel(`compliance_documents_library_${onlyItemId || 'all'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compliance_item_documents' }, () => fetchDocs())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compliance_document_links' }, () => fetchDocs())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compliance_document_tag_assignments' }, () => fetchDocs())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [fetchDocs, onlyItemId])

  const filtered = useMemo(() => {
    const q = (filters.search || '').trim().toLowerCase()
    return docs.filter((d) => {
      if (!matchesQuery(d, q)) return false
      if (filters.authority && filters.authority !== 'all') {
        if (d.compliance_items?.compliance_authorities?.name !== filters.authority) return false
      }
      if (filters.tag && filters.tag !== 'all') {
        if (!tagNames(d).includes(filters.tag)) return false
      }
      return true
    })
  }, [docs, filters.search, filters.authority, filters.tag])

  return { docs: filtered, allDocs: docs, loading, refresh: fetchDocs }
}

// Document tags — used by the Library filter dropdown + the Tags editor.
export function useComplianceDocumentTags() {
  const [tags, setTags] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchTags = useCallback(async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('compliance_document_tags')
        .select('*')
        .order('name', { ascending: true })
      if (error) throw error
      setTags(data || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTags()
    const ch = supabase
      .channel('compliance_document_tags_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compliance_document_tags' }, () => fetchTags())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [fetchTags])

  return { tags, loading, refresh: fetchTags }
}

// Single document fetch — for the review screen.
export function useComplianceDocument(docId) {
  const [doc, setDoc] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchDoc = useCallback(async () => {
    if (!docId) return
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('compliance_item_documents')
        .select(DOC_SELECT)
        .eq('id', docId)
        .single()
      if (error) throw error
      setDoc(data)
    } finally {
      setLoading(false)
    }
  }, [docId])

  useEffect(() => {
    fetchDoc()
    if (!docId) return undefined
    const ch = supabase
      .channel(`compliance_doc_${docId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compliance_item_documents', filter: `id=eq.${docId}` }, () => fetchDoc())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [fetchDoc, docId])

  return { doc, loading, refresh: fetchDoc }
}