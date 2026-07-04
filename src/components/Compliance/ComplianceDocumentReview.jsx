// Per-document review screen: original file (preview) on the left, extracted
// editable fields on the right with Approve / Reject / Save-edits actions.
//
// If no specific docId is passed, shows the latest document in this item that
// is in `waiting_for_review`.
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { useLanguage } from '../../context/LanguageContext'
import { useComplianceDocument } from '../../hooks/useComplianceDocuments'
import {
  METADATA_FIELDS, processingColor, formatConfidence, confidenceColor,
} from '../../utils/documentProcessing'
import LoadingSpinner from '../LoadingSpinner'
import DocumentPreviewModal from './DocumentPreviewModal'
import { Check, X, Save, RefreshCw, Eye, ArrowUpRight } from '../ui/Icons'

export default function ComplianceDocumentReview({ itemId }) {
  const { t } = useLanguage()
  const { user } = useAuth()
  const { success, error: showError } = useToast()
  const [params] = useSearchParams()
  const forcedDocId = params.get('doc')

  const [pendingDocs, setPendingDocs] = useState([])
  const [activeDocId, setActiveDocId] = useState(forcedDocId || null)
  const { doc, loading: docLoading } = useComplianceDocument(activeDocId)
  const [formValues, setFormValues] = useState({})
  const [previewOpen, setPreviewOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Load pending docs for this item.
  useEffect(() => {
    if (!itemId) return undefined
    const load = async () => {
      const { data, error } = await supabase
        .from('compliance_item_documents')
        .select('id, file_name, processing_status, review_status, confidence_score')
        .eq('item_id', itemId)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) { showError(error.message); return }
      const list = data || []
      setPendingDocs(list)
      // Default: most recent waiting_for_review, or whatever the URL specified.
      if (!activeDocId) {
        const candidate = list.find((d) => d.processing_status === 'waiting_for_review')
                       || list[0]
        if (candidate) setActiveDocId(candidate.id)
      }
    }
    load()
    const ch = supabase
      .channel(`compliance_review_${itemId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compliance_item_documents', filter: `item_id=eq.${itemId}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [itemId])

  // When active doc changes, hydrate formValues from extracted_metadata.
  useEffect(() => {
    if (!doc) { setFormValues({}); return }
    let meta = {}
    try {
      meta = typeof doc.extracted_metadata === 'string'
        ? JSON.parse(doc.extracted_metadata)
        : doc.extracted_metadata || {}
    } catch (_) { meta = {} }
    const base = { ...meta }
    // Pre-fill authority_name from the item relation so users have a sane default.
    if (!base.authority_name && doc.compliance_items?.compliance_authorities?.name) {
      base.authority_name = doc.compliance_items.compliance_authorities.name
    }
    setFormValues(base)
  }, [doc?.id])

  const handleChange = (k, v) => setFormValues((f) => ({ ...f, [k]: v }))

  const submitReview = async (reviewStatus) => {
    if (!doc) return
    try {
      setSubmitting(true)
      // 1) Persist edits to extracted_metadata.
      const { error: upErr } = await supabase
        .from('compliance_item_documents')
        .update({ extracted_metadata: formValues, review_status: reviewStatus })
        .eq('id', doc.id)
      if (upErr) throw upErr
      // 2) Lock the review.
      const { error: revErr } = await supabase.rpc('review_document', {
        p_document_id: doc.id,
        p_status: reviewStatus,
        p_reviewer_email: user?.email || '',
      })
      if (revErr) throw revErr
      success(reviewStatus === 'approved'
        ? t('compliance.review.status_approved')
        : reviewStatus === 'rejected'
          ? t('compliance.review.status_rejected')
          : t('compliance.review.status_edited'))
    } catch (err) {
      showError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const requeue = async () => {
    if (!doc) return
    try {
      setSubmitting(true)
      const { error } = await supabase.rpc('enqueue_document', { p_document_id: doc.id })
      if (error) throw error
      success(t('compliance.processing.queued'))
    } catch (err) {
      showError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // Send the (possibly edited) extracted fields back to the parent compliance
  // item, then optionally link the document to the resolved authority. We
  // persist edits first so the SQL function reads exactly what the user sees.
  const applyToItem = async () => {
    if (!doc) return
    try {
      setSubmitting(true)
      const { error: upErr } = await supabase
        .from('compliance_item_documents')
        .update({ extracted_metadata: formValues })
        .eq('id', doc.id)
      if (upErr) throw upErr

      const { data, error } = await supabase.rpc('apply_extracted_metadata', {
        p_document_id: doc.id,
        p_actor_email:  user?.email || '',
      })
      if (error) throw error

      const appliedCount = Array.isArray(data?.applied) ? data.applied.length
                          : data?.applied ? Object.keys(data.applied).length : 0
      const skippedCount = Array.isArray(data?.skipped) ? data.skipped.length
                          : data?.skipped ? Object.keys(data.skipped).length : 0
      const summaryParts = []
      if (appliedCount) summaryParts.push(t('compliance.review.apply_result_prefix', { n: appliedCount }))
      if (data?.linked_authority_id) summaryParts.push(t('compliance.review.apply_linked_authority'))
      if (skippedCount) summaryParts.push(t('compliance.review.apply_skipped', { n: skippedCount }))
      const errors = Array.isArray(data?.errors) ? data.errors : []
      if (errors.length) summaryParts.push(errors.join(', '))
      success(summaryParts.join(' • ') || 'Done')
    } catch (err) {
      showError(t('compliance.review.apply_failed', { msg: err.message }))
    } finally {
      setSubmitting(false)
    }
  }

  if (docLoading) return <LoadingSpinner />

  if (!doc) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed border-gray-200 rounded">
        <p className="text-sm text-gray-500">{t('compliance.review.no_documents_to_review')}</p>
      </div>
    )
  }

  const pc = processingColor(doc.processing_status)
  const cc = confidenceColor(doc.confidence_score)

  return (
    <div className="space-y-3">
      {/* doc selector + meta */}
      <div className="flex flex-wrap items-center gap-2">
        {pendingDocs.length > 1 && (
          <select className="input py-2 text-sm w-72 rounded-lg border-gray-300" value={doc.id} onChange={(e) => setActiveDocId(Number(e.target.value))}>
            {pendingDocs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.file_name} — {t(`compliance.processing.${d.processing_status}`)}
              </option>
            ))}
          </select>
        )}
        <span className={`inline px-2 py-0.5 rounded-full text-[11px] font-medium ${pc.bg} ${pc.text}`}>
          {t(`compliance.processing.${doc.processing_status}`)}
        </span>
        <span className={`inline px-2 py-0.5 rounded-full text-[11px] font-medium ${cc.bg} ${cc.text}`}>
          {t('compliance.review.confidence')}: {formatConfidence(doc.confidence_score)}
        </span>
        <button type="button" onClick={() => setPreviewOpen(true)} className="btn btn-secondary py-1.5 px-3 text-sm flex items-center gap-1.5 ml-auto">
          <Eye size={14} /> {t('compliance.review.original')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Left: preview */}
        <div className="bg-white border border-gray-200 rounded overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700 uppercase">
            {t('compliance.review.original')}
          </div>
          <DocumentPreviewContent doc={doc} />
        </div>

        {/* Right: extracted fields */}
        <div className="bg-white border border-gray-200 rounded p-3 space-y-2">
          <h4 className="text-sm font-semibold text-gray-700">{t('compliance.review.extracted_fields')}</h4>

          {Object.keys(formValues).length === 0 && (
            <p className="text-sm text-gray-500">{t('compliance.review.no_extracted_fields')}</p>
          )}

          {METADATA_FIELDS.map((field) => {
            const v = formValues[field.key]
            return (
              <div key={field.key} className="space-y-0.5">
                <label className="label text-xs">{t(field.labelKey)}</label>
                <input
                  type={field.key.includes('date') ? 'date' : field.key.includes('amount') || field.key.includes('period') ? 'number' : 'text'}
                  className="input w-full py-1.5 text-sm"
                  value={v == null ? '' : String(v)}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                />
              </div>
            )
          })}

          {doc.ai_summary && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <label className="label text-xs">{t('compliance.review.extracted_fields')} — Summary</label>
              <p className="text-sm text-gray-700 bg-gray-50 p-2 rounded">{doc.ai_summary}</p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-gray-100 mt-2">
            <button
              type="button"
              onClick={applyToItem}
              disabled={submitting || doc.processing_status !== 'waiting_for_review' || !doc.item_id}
              title={t('compliance.review.apply_to_item_help')}
              className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 px-3 rounded text-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              <ArrowUpRight size={14} /> {t('compliance.review.apply_to_item')}
            </button>
            <button type="button" onClick={() => submitReview('approved')} disabled={submitting || !doc.item_id} className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-3 rounded text-sm flex items-center gap-1.5 disabled:opacity-50">
              <Check size={14} /> {t('compliance.review.approve')}
            </button>
            <button type="button" onClick={() => submitReview('rejected')} disabled={submitting} className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-3 rounded text-sm flex items-center gap-1.5 disabled:opacity-50">
              <X size={14} /> {t('compliance.review.reject')}
            </button>
            <button type="button" onClick={() => submitReview('edited')} disabled={submitting} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-3 rounded text-sm flex items-center gap-1.5 disabled:opacity-50">
              <Save size={14} /> {t('compliance.review.saveEdits')}
            </button>
            <button type="button" onClick={requeue} disabled={submitting} className="btn btn-secondary py-1.5 px-3 text-sm flex items-center gap-1.5">
              <RefreshCw size={14} /> {t('compliance.review.requeue')}
            </button>
          </div>
        </div>
      </div>

      <DocumentPreviewModal doc={doc} open={previewOpen} onClose={() => setPreviewOpen(false)} />
    </div>
  )
}

function DocumentPreviewContent({ doc }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let cancelled = false
    if (!doc) return undefined
    ;(async () => {
      const { data, error } = await supabase.storage.from(doc.bucket || 'compliance-documents').createSignedUrl(doc.storage_path, 120)
      if (!cancelled && !error && data?.signedUrl) setUrl(data.signedUrl)
    })()
    return () => { cancelled = true }
  }, [doc?.id])

  if (!url) return <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>
  const isPdf = (doc.mime_type || '').includes('pdf')
  const isImage = (doc.mime_type || '').startsWith('image/')
  if (isPdf) return <iframe title={doc.file_name} src={url} className="w-full" style={{ height: '60vh' }} />
  if (isImage) return <img src={url} alt={doc.file_name} className="max-w-full max-h-[60vh] mx-auto" />
  return <a href={url} download={doc.file_name} className="btn btn-primary inline-flex items-center gap-2 m-3">Download</a>
}