// Compliance Inbox — workflow home: upload papers, watch AI extraction,
// then review and file them. Replaces the old dashboard + separate import page.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useLanguage } from '../../context/LanguageContext'
import { useToast } from '../../context/ToastContext'
import { useImportJob } from '../../hooks/useImportJob'
import { isImportMigrationError, ORPHAN_DOC_LIST_SELECT } from '../../utils/complianceImport'
import { collectFilesFromDataTransfer, UPLOAD_JOB_TONES } from '../../utils/complianceUpload'
import { processingColor, reviewColor } from '../../utils/documentProcessing'
import { useComplianceWorkerStatus } from './ComplianceWorkerContext'
import CompliancePipelineStepper from './CompliancePipelineStepper'
import AiWorkerStatus from './AiWorkerStatus'
import LoadingSpinner from '../LoadingSpinner'
import {
  Upload, FileText, ChevronRight, Package, RefreshCw, X, Check,
} from '../ui/Icons'

const DOC_INBOX_SELECT = `
  id, file_name, mime_type, size_bytes, processing_status, review_status,
  created_at, updated_at, item_id,
  compliance_items:item_id ( id, title )
`

const WORKING = new Set(['uploaded', 'queued', 'ocr_processing', 'text_extracted', 'classified', 'metadata_extracted'])

function DocRow({ doc, t, actionLabel, onAction }) {
  const pc = processingColor(doc.processing_status)
  const rc = reviewColor(doc.review_status)
  return (
    <li className="flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50 transition-colors">
      <FileText size={18} className="text-gray-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate" title={doc.file_name}>{doc.file_name}</p>
        <div className="flex flex-wrap items-center gap-1 mt-0.5">
          <span className={`inline px-1.5 py-0.5 rounded text-[10px] font-medium ${pc.bg} ${pc.text}`}>
            {t(`compliance.processing.${doc.processing_status || 'uploaded'}`)}
          </span>
          {doc.review_status && (
            <span className={`inline px-1.5 py-0.5 rounded text-[10px] font-medium ${rc.bg} ${rc.text}`}>
              {t(`compliance.review.status_${doc.review_status}`)}
            </span>
          )}
          {doc.compliance_items?.title && (
            <span className="text-[10px] text-gray-500 truncate max-w-[140px]">{doc.compliance_items.title}</span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onAction(doc)}
        className="text-xs text-rose-700 hover:underline inline-flex items-center gap-0.5 flex-shrink-0 font-medium"
      >
        {actionLabel} <ChevronRight size={12} />
      </button>
    </li>
  )
}

export default function ComplianceInbox() {
  const { t } = useLanguage()
  const { user } = useAuth()
  const { success, error: showError } = useToast()
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const worker = useComplianceWorkerStatus()

  const [processing, setProcessing] = useState([])
  const [attention, setAttention] = useState([])
  const [filed, setFiled] = useState([])
  const [loading, setLoading] = useState(true)
  const [migrationNeeded, setMigrationNeeded] = useState(false)
  const [dropActive, setDropActive] = useState(false)

  const refreshQueues = useCallback(async () => {
    try {
      setLoading(true)
      const [procRes, attOrphanRes, attReviewRes, filedRes] = await Promise.all([
        supabase
          .from('compliance_item_documents')
          .select(DOC_INBOX_SELECT)
          .in('processing_status', Array.from(WORKING))
          .order('updated_at', { ascending: false })
          .limit(30),
        supabase
          .from('compliance_item_documents')
          .select(ORPHAN_DOC_LIST_SELECT)
          .is('item_id', null)
          .neq('processing_status', 'failed')
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('compliance_item_documents')
          .select(DOC_INBOX_SELECT)
          .eq('processing_status', 'waiting_for_review')
          .not('item_id', 'is', null)
          .order('updated_at', { ascending: false })
          .limit(30),
        supabase
          .from('compliance_item_documents')
          .select(DOC_INBOX_SELECT)
          .eq('review_status', 'approved')
          .order('updated_at', { ascending: false })
          .limit(12),
      ])

      const err = procRes.error || attOrphanRes.error || attReviewRes.error || filedRes.error
      if (err) throw err

      setMigrationNeeded(false)
      setProcessing(procRes.data || [])

      const orphanIds = new Set((attOrphanRes.data || []).map((d) => d.id))
      const mergedAttention = [
        ...(attOrphanRes.data || []),
        ...(attReviewRes.data || []).filter((d) => !orphanIds.has(d.id)),
      ]
      setAttention(mergedAttention)
      setFiled(filedRes.data || [])
    } catch (err) {
      if (isImportMigrationError(err)) setMigrationNeeded(true)
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }, [showError])

  const { jobs, enqueue, retry, remove, clearCompleted } = useImportJob({
    userEmail: user?.email || '',
    userId: user?.id || null,
    onJobComplete: ({ fileName }) => {
      refreshQueues()
      success(t('compliance.import.upload_complete', { name: fileName || 'File' }))
    },
    onJobFailed: ({ message }) => {
      if (message) showError(message)
      if (isImportMigrationError({ message })) setMigrationNeeded(true)
    },
  })

  useEffect(() => {
    refreshQueues()
    const ch = supabase
      .channel('compliance_inbox_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compliance_item_documents' }, () => refreshQueues())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [refreshQueues])

  const uploadStats = useMemo(() => {
    let running = 0
    for (const j of jobs) {
      if (j.status === 'uploading' || j.status === 'server_pending' || j.status === 'queued') running++
    }
    return { running, total: jobs.length }
  }, [jobs])

  const activePipelineStep = useMemo(() => {
    if (uploadStats.running > 0) return 1
    if (worker.busy || processing.length > 0) return 2
    if (attention.length > 0) return 3
    return 4
  }, [uploadStats.running, worker.busy, processing.length, attention.length])

  const openDoc = (doc) => {
    if (doc.item_id == null) {
      navigate(`/compliance/review-orphan/${doc.id}`)
    } else if (doc.processing_status === 'waiting_for_review') {
      navigate(`/compliance/item/${doc.item_id}?doc=${doc.id}`)
    } else {
      navigate(`/compliance/item/${doc.item_id}`)
    }
  }

  const onDragOver = (e) => { e.preventDefault(); setDropActive(true) }
  const onDragLeave = (e) => { e.preventDefault(); setDropActive(false) }
  const onDrop = async (e) => {
    e.preventDefault()
    setDropActive(false)
    try {
      const files = await collectFilesFromDataTransfer(e.dataTransfer)
      if (files.length > 0) enqueue(files)
      else if (e.dataTransfer.files?.length > 0) enqueue(Array.from(e.dataTransfer.files))
    } catch (err) {
      showError(err.message || 'Failed to read dropped items')
    }
  }
  const onPick = (e) => {
    const fl = e.target.files
    if (!fl?.length) return
    enqueue(Array.from(fl))
    e.target.value = ''
  }

  if (loading && processing.length === 0 && attention.length === 0) {
    return <LoadingSpinner />
  }

  return (
    <div className="flex flex-col gap-4 pb-6">
      <CompliancePipelineStepper activeStep={activePipelineStep} />

      <AiWorkerStatus busy={worker.busy} lastResult={worker.lastResult} variant="card" />

      {(!user?.id) && (
        <div className="bg-red-50 border border-red-200 text-red-900 rounded-xl p-4 text-sm">
          {t('compliance.import.sign_in_required')}
        </div>
      )}

      {migrationNeeded && (
        <div className="bg-amber-50 border border-amber-300 text-amber-950 rounded-xl p-4 text-sm">
          <p className="font-semibold">{t('compliance.import.migration_title')}</p>
          <p className="mt-1">{t('compliance.import.migration_body')}</p>
        </div>
      )}

      {/* Upload zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`relative rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
          dropActive
            ? 'border-rose-500 bg-rose-50 shadow-inner'
            : 'border-rose-200 bg-gradient-to-b from-rose-50/80 to-white hover:border-rose-300'
        }`}
      >
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-rose-100 text-rose-600 mb-3">
          <Package size={28} />
        </div>
        <h2 className="text-lg font-bold text-gray-900">{t('compliance.workflow.upload_title')}</h2>
        <p className="text-sm text-gray-600 mt-1 max-w-md mx-auto">{t('compliance.workflow.upload_subtitle')}</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={!user?.id}
          className="mt-4 inline-flex items-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-semibold py-2.5 px-5 rounded-lg text-sm shadow-sm"
        >
          <Upload size={18} /> {t('compliance.import.choose_files')}
        </button>
        <p className="text-[11px] text-gray-400 mt-3">{t('compliance.import.dropzone_help')}</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt,application/pdf,image/*"
          onChange={onPick}
        />
      </div>

      {/* Active uploads */}
      {jobs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">{t('compliance.import.queue_title')}</h3>
            {jobs.some((j) => j.status === 'completed') && (
              <button type="button" onClick={clearCompleted} className="text-xs text-rose-700 hover:underline">
                {t('compliance.import.clear_completed')}
              </button>
            )}
          </div>
          <ul className="divide-y divide-gray-100 max-h-48 overflow-y-auto">
            {jobs.map((j) => {
              const tone = UPLOAD_JOB_TONES[j.status] || UPLOAD_JOB_TONES.queued
              return (
                <li key={j.jobId} className="px-4 py-2 flex items-center gap-3">
                  <FileText size={16} className="text-gray-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm truncate">{j.fileName}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${tone.bg} ${tone.text}`}>
                        {t(`compliance.import.status.${j.status}`)}
                      </span>
                    </div>
                    {!j.error && j.status !== 'completed' && (
                      <div className="mt-1 h-1 bg-gray-100 rounded overflow-hidden">
                        <div className="h-full bg-rose-500 transition-[width]" style={{ width: `${j.progress || 8}%` }} />
                      </div>
                    )}
                    {j.error && <p className="text-[11px] text-red-600 mt-0.5">{j.error}</p>}
                  </div>
                  {j.status === 'failed' && (
                    <button type="button" onClick={() => retry(j.jobId)} className="text-xs text-rose-700">
                      <RefreshCw size={14} />
                    </button>
                  )}
                  <button type="button" onClick={() => remove(j.jobId)} className="p-1 text-gray-400 hover:text-gray-600" aria-label="Remove">
                    <X size={14} />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Three queues */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col min-h-[200px]">
          <header className="px-4 py-3 bg-indigo-50 border-b border-indigo-100">
            <h3 className="text-sm font-semibold text-indigo-900">{t('compliance.workflow.col_processing')}</h3>
            <p className="text-[11px] text-indigo-700/80 mt-0.5">{t('compliance.workflow.col_processing_hint')}</p>
          </header>
          {processing.length === 0 ? (
            <p className="text-sm text-gray-500 p-4 text-center flex-1 flex items-center justify-center">
              {t('compliance.workflow.empty_processing')}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 flex-1 overflow-y-auto max-h-80">
              {processing.map((d) => (
                <DocRow
                  key={d.id}
                  doc={d}
                  t={t}
                  actionLabel={t('compliance.workflow.view')}
                  onAction={openDoc}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden flex flex-col min-h-[200px] ring-1 ring-amber-100">
          <header className="px-4 py-3 bg-amber-50 border-b border-amber-100">
            <h3 className="text-sm font-semibold text-amber-900">
              {t('compliance.workflow.col_attention')}
              {attention.length > 0 && (
                <span className="ms-2 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-amber-600 text-white text-[10px] font-bold">
                  {attention.length}
                </span>
              )}
            </h3>
            <p className="text-[11px] text-amber-800/80 mt-0.5">{t('compliance.workflow.col_attention_hint')}</p>
          </header>
          {attention.length === 0 ? (
            <div className="p-4 flex-1 flex flex-col items-center justify-center text-center">
              <Check size={28} className="text-green-500 mb-2" />
              <p className="text-sm text-gray-600">{t('compliance.workflow.empty_attention')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 flex-1 overflow-y-auto max-h-80">
              {attention.map((d) => (
                <DocRow
                  key={d.id}
                  doc={d}
                  t={t}
                  actionLabel={t('compliance.import.review_orphan')}
                  onAction={openDoc}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col min-h-[200px]">
          <header className="px-4 py-3 bg-green-50 border-b border-green-100">
            <h3 className="text-sm font-semibold text-green-900">{t('compliance.workflow.col_filed')}</h3>
            <p className="text-[11px] text-green-800/80 mt-0.5">{t('compliance.workflow.col_filed_hint')}</p>
          </header>
          {filed.length === 0 ? (
            <p className="text-sm text-gray-500 p-4 text-center flex-1 flex items-center justify-center">
              {t('compliance.workflow.empty_filed')}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 flex-1 overflow-y-auto max-h-80">
              {filed.map((d) => (
                <DocRow
                  key={d.id}
                  doc={d}
                  t={t}
                  actionLabel={t('compliance.workflow.open_item')}
                  onAction={openDoc}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          onClick={() => navigate('/compliance/documents')}
          className="btn btn-secondary text-sm py-2 px-3"
        >
          {t('compliance.workflow.browse_all_docs')}
        </button>
        <button
          type="button"
          onClick={() => navigate('/compliance/items')}
          className="btn btn-secondary text-sm py-2 px-3"
        >
          {t('compliance.tab_items')}
        </button>
        <button
          type="button"
          onClick={() => navigate('/compliance/calendar')}
          className="btn btn-secondary text-sm py-2 px-3"
        >
          {t('compliance.tab_calendar')}
        </button>
      </div>
    </div>
  )
}
