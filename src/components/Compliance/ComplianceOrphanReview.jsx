// /compliance/review-orphan/:docId — review screen for a document that is
// still in orphan state (item_id IS NULL). Edit extracted metadata; commit to
// create a brand-new compliance_items row or link to an existing one.
//
// While the document stays orphan:
//   - Approve is disabled (hard-block per product decision).
//   - "Create new item" reads intended_title / intended_authority / extracted
//     metadata, inserts a fresh item, flips the orphan, then runs the
//     existing apply_extracted_metadata pipeline by way of the RPC.
//   - "Link to existing item" attaches the doc to a chosen item_id and runs
//     the same apply_extracted_metadata as a side effect.
//
// After either action, the user lands inside the now-attached item detail page
// (because the orphan flagged disappears and review actions unlock).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useLanguage } from '../../context/LanguageContext'
import { useToast } from '../../context/ToastContext'
import {
  METADATA_FIELDS, processingColor, formatConfidence, confidenceColor,
} from '../../utils/documentProcessing'
import LoadingSpinner from '../LoadingSpinner'
import DocumentPreviewModal from './DocumentPreviewModal'
import ConfirmDialog from '../ui/ConfirmDialog'
import Modal from '../ui/Modal'
import {
  Check, X, Save, RefreshCw, Eye, ArrowUpRight, Plus, Search, Tag,
} from '../ui/Icons'

export default function ComplianceOrphanReview() {
  const { t } = useLanguage()
  const { user } = useAuth()
  const { success, error: showError } = useToast()
  const navigate = useNavigate()
  const { docId } = useParams()

  const [doc, setDoc] = useState(null)
  const [loadingDoc, setLoadingDoc] = useState(true)
  const [formValues, setFormValues] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [items, setItems] = useState([])
  const [itemSearch, setItemSearch] = useState('')
  const [selectedItemId, setSelectedItemId] = useState(null)
  const [confirmRejectOpen, setConfirmRejectOpen] = useState(false)

  // ---------------- Load orphan ----------------
  const loadDoc = async () => {
    if (!docId) return
    try {
      setLoadingDoc(true)
      const { data, error } = await supabase
        .from('compliance_item_documents')
        .select('id, item_id, is_orphan, intended_title, intended_authority, file_name, storage_path, bucket, mime_type, processing_status, review_status, confidence_score, extracted_text, extracted_metadata, ai_summary')
        .eq('id', docId)
        .single()
      if (error) throw error
      setDoc(data)
      let meta = {}
      try {
        meta = typeof data.extracted_metadata === 'string' ? JSON.parse(data.extracted_metadata) : data.extracted_metadata || {}
      } catch (_) { meta = {} }
      const base = { ...meta }
      if (data.intended_title && !base.title) base.title = data.intended_title
      if (data.intended_authority && !base.authority_name) base.authority_name = data.intended_authority
      setFormValues(base)
    } catch (err) {
      showError(err.message)
    } finally {
      setLoadingDoc(false)
    }
  }
  useEffect(() => {
    loadDoc()
    if (!docId) return undefined
    const ch = supabase
      .channel(`orphan_doc_${docId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compliance_item_documents', filter: `id=eq.${docId}` }, () => loadDoc())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [docId])

  // Quick result: as soon as item_id flips away from NULL, the doc is no
  // longer orphan; bounce the user into the item detail page.
  useEffect(() => {
    if (doc && doc.item_id != null) {
      navigate(`/compliance/item/${doc.item_id}`, { replace: true })
    }
  }, [doc?.item_id])

  // ---------------- Search existing items for link modal ----------------
  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase()
    if (!q) return items.slice(0, 100)
    return items.filter((i) => (i.title || '').toLowerCase().includes(q)).slice(0, 50)
  }, [items, itemSearch])

  useEffect(() => {
    if (!linkOpen) return undefined
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('compliance_items')
        .select('id, title, status, expiry_date, compliance_authorities:authority_id ( id, name )')
        .order('updated_at', { ascending: false })
        .limit(200)
      if (!cancelled && error) showError(error.message)
      if (!cancelled) setItems(data || [])
    })()
    return () => { cancelled = true }
  }, [linkOpen])

  // ---------------- Actions ----------------
  const persistMeta = async () => {
    const { intended_title, intended_authority, ...rest } = formValues
    const { error } = await supabase
      .from('compliance_item_documents')
      .update({ extracted_metadata: rest, intended_title, intended_authority })
      .eq('id', doc.id)
    if (error) throw error
  }

  const requeue = async () => {
    setSubmitting(true)
    try {
      // Orphans don't auto-enqueue because they have no parent. A manual
      // requeue just pokes status=queued again; the orphan guard will keep
      // the worker from actually moving it forward until the parent is set.
      const { error } = await supabase
        .from('compliance_item_documents')
        .update({ processing_status: 'queued', processing_errors: [] })
        .eq('id', doc.id)
      if (error) throw error
      success(t('compliance.processing.queued'))
    } catch (err) {
      showError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const submitReview = async (reviewStatus) => {
    if (reviewStatus === 'approved') { showError(t('compliance.import.cannot_approve_orphan')); return }
    setSubmitting(true)
    try {
      await persistMeta()
      const { error } = await supabase.rpc('review_document', {
        p_document_id: doc.id,
        p_status: reviewStatus,
        p_reviewer_email: user?.email || '',
      })
      if (error) throw error
      success(t(`compliance.review.status_${reviewStatus}`))
    } catch (err) {
      showError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const createItem = async () => {
    setSubmitting(true)
    try {
      await persistMeta()
      const { data, error } = await supabase.rpc('create_item_from_orphan', {
        p_document_id: doc.id,
        p_actor_email:  user?.email || '',
      })
      if (error) throw error
      const errors = Array.isArray(data?.errors) ? data.errors : []
      if (errors.length) throw new Error(errors.join(', '))
      success(t('compliance.import.orphan_created_item', { n: data?.item_id }))
      // The realtime listener above will navigate us into the item.
    } catch (err) {
      showError(err.message)
    } finally {
      setSubmitting(false)
      setCreateOpen(false)
    }
  }

  const linkItem = async () => {
    if (!selectedItemId) return
    setSubmitting(true)
    try {
      await persistMeta()
      const { data, error } = await supabase.rpc('link_orphan_to_item', {
        p_document_id: doc.id,
        p_item_id:     selectedItemId,
        p_actor_email: user?.email || '',
      })
      if (error) throw error
      const errors = Array.isArray(data?.errors) ? data.errors : []
      if (errors.length) throw new Error(errors.join(', '))
      success(t('compliance.import.orphan_linked_item'))
    } catch (err) {
      showError(err.message)
    } finally {
      setSubmitting(false)
      setLinkOpen(false)
    }
  }

  if (loadingDoc) return <LoadingSpinner />
  if (!doc) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed border-gray-200 rounded">
        <p className="text-sm text-gray-500">{t('compliance.review.no_documents_to_review')}</p>
      </div>
    )
  }

  const pc = processingColor(doc.processing_status)
  const cc = confidenceColor(doc.confidence_score)
  const blocked = doc.is_orphan || doc.item_id == null

  return (
    <div className="space-y-3">

      {blocked && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded p-3 text-sm">
          {t('compliance.import.orphan_help')}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
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

        <div className="bg-white border border-gray-200 rounded overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700 uppercase">
            {t('compliance.review.original')}
          </div>
          <OrphanPreview doc={doc} />
        </div>

        <div className="bg-white border border-gray-200 rounded p-3 space-y-2">
          <h4 className="text-sm font-semibold text-gray-700">{t('compliance.review.extracted_fields')}</h4>
          {METADATA_FIELDS.map((field) => {
            const v = formValues[field.key]
            return (
              <div key={field.key} className="space-y-0.5">
                <label className="label text-xs">{t(field.labelKey)}</label>
                <input
                  type={field.key.includes('date') ? 'date' : field.key.includes('amount') || field.key.includes('period') ? 'number' : 'text'}
                  className="input w-full py-1.5 text-sm"
                  value={v == null ? '' : String(v)}
                  onChange={(e) => setFormValues((f) => ({ ...f, [field.key]: e.target.value }))}
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
            <button type="button" onClick={() => setCreateOpen(true)} disabled={submitting} className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 px-3 rounded text-sm flex items-center gap-1.5 disabled:opacity-50">
              <Plus size={14} /> {t('compliance.import.create_item')}
            </button>
            <button type="button" onClick={() => setLinkOpen(true)} disabled={submitting} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-3 rounded text-sm flex items-center gap-1.5 disabled:opacity-50">
              <Tag size={14} /> {t('compliance.import.link_existing_item')}
            </button>
            <button type="button" onClick={() => submitReview('edited')} disabled={submitting} className="bg-gray-600 hover:bg-gray-700 text-white font-semibold py-2 px-3 rounded text-sm flex items-center gap-1.5 disabled:opacity-50">
              <Save size={14} /> {t('compliance.review.saveEdits')}
            </button>
            <button type="button" onClick={() => setConfirmRejectOpen(true)} disabled={submitting} className="bg-red-100 text-red-700 hover:bg-red-200 font-semibold py-2 px-3 rounded text-sm flex items-center gap-1.5 disabled:opacity-50">
              <X size={14} /> {t('compliance.review.reject')}
            </button>
            <button type="button" onClick={requeue} disabled={submitting} className="ml-auto btn btn-secondary py-1.5 px-3 text-sm flex items-center gap-1.5">
              <RefreshCw size={14} /> {t('compliance.review.requeue')}
            </button>

            <ConfirmDialog
              isOpen={confirmRejectOpen}
              onClose={() => setConfirmRejectOpen(false)}
              onConfirm={() => submitReview('rejected')}
              title={t('compliance.review.reject')}
              message={t('compliance.import.reject_orphan_confirm')}
              confirmLabel={t('compliance.review.reject')}
              isLoading={submitting}
              variant="danger"
            />
          </div>

          <div className="pt-3 border-t border-gray-100 text-xs text-gray-500">
            {t('compliance.import.approve_blocked_explainer')}
          </div>
        </div>
      </div>

      <DocumentPreviewModal doc={doc} open={previewOpen} onClose={() => setPreviewOpen(false)} />

      {/* Create new item modal */}
      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title={t('compliance.import.create_item')} size="sm">
        <p className="text-sm text-gray-700 mb-3">{t('compliance.import.create_item_help')}</p>
        <div className="flex items-center gap-2 justify-end">
          <button type="button" className="btn btn-secondary py-1.5 px-3 text-sm" onClick={() => setCreateOpen(false)}>
            {t('common.cancel')}
          </button>
          <button type="button" onClick={createItem} disabled={submitting} className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 px-3 rounded text-sm flex items-center gap-1.5 disabled:opacity-50">
            <Check size={14} /> {t('compliance.import.confirm_create')}
          </button>
        </div>
      </Modal>

      {/* Link to existing modal */}
      <Modal isOpen={linkOpen} onClose={() => setLinkOpen(false)} title={t('compliance.import.link_existing_item')} size="lg">
        <p className="text-sm text-gray-700 mb-3">{t('compliance.import.link_existing_item_help')}</p>
        <div className="flex items-center gap-2 mb-2">
          <Search size={16} className="text-gray-500" />
          <input
            type="search"
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
            placeholder={t('common.search')}
            className="input flex-1 py-2 text-sm"
          />
        </div>
        <div className="max-h-[40vh] overflow-y-auto border border-gray-200 rounded">
          {filteredItems.length === 0 ? (
            <p className="text-sm text-gray-500 p-3">{t('common.noResults')}</p>
          ) : filteredItems.map((it) => (
            <label
              key={it.id}
              className={`flex items-start gap-2 p-2 cursor-pointer hover:bg-gray-50 ${selectedItemId === it.id ? 'bg-rose-50' : ''}`}
            >
              <input
                type="radio"
                checked={selectedItemId === it.id}
                onChange={() => setSelectedItemId(it.id)}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{it.title}</p>
                <p className="text-[11px] text-gray-500">
                  {it.compliance_authorities?.name ? `${it.compliance_authorities.name} · ` : ''}
                  {it.status}{it.expiry_date ? ` · ${it.expiry_date}` : ''}
                </p>
              </div>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2 justify-end mt-3">
          <button type="button" className="btn btn-secondary py-1.5 px-3 text-sm" onClick={() => setLinkOpen(false)}>
            {t('common.cancel')}
          </button>
          <button type="button" onClick={linkItem} disabled={submitting || !selectedItemId} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-3 rounded text-sm flex items-center gap-1.5 disabled:opacity-50">
            <Check size={14} /> {t('compliance.import.confirm_link')}
          </button>
        </div>
      </Modal>
    </div>
  )
}

function OrphanPreview({ doc }) {
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
