// /compliance/import — Google Drive / Dropbox-style ingestion surface.
//
// UX flow:
//   1) Drop or pick files -> jobs appear in the queue with live progress.
//   2) Successful uploads become orphan documents (item_id = NULL).
//   3) Live pipeline (enqueue runs the moment the orphan is linked or the
//      user explicitly opts in to a "process orphan" run).
//   4) The orphan list below points at each document with quick "Review" /
//      "Create item" / "Link to item" actions.
//
// Drag-and-drop covers folders when the browser exposes webkitGetAsEntry
// (Chromium). Falls back to flat file list on other engines.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useLanguage } from '../../context/LanguageContext'
import { useToast } from '../../context/ToastContext'
import { useImportJob } from '../../hooks/useImportJob'
import { isImportMigrationError, ORPHAN_DOC_LIST_SELECT } from '../../utils/complianceImport'
import { complianceTabPath } from '../../utils/complianceRoutes'
import LoadingSpinner from '../LoadingSpinner'
import EmptyState from '../ui/EmptyState'
import {
  Upload, RefreshCw, X, FileText, Check, AlertCircle, Package, ChevronRight, ArrowLeft,
} from '../ui/Icons'

// ---------- helpers ----------------------------------------------------------

const STATUS_TONE = {
  queued:        { bg: 'bg-gray-100',  text: 'text-gray-700' },
  uploading:     { bg: 'bg-blue-100',  text: 'text-blue-700' },
  server_pending:{ bg: 'bg-indigo-100',text: 'text-indigo-700' },
  completed:     { bg: 'bg-green-100', text: 'text-green-800' },
  failed:        { bg: 'bg-red-100',   text: 'text-red-700' },
}

async function collectFiles(dataTransfer) {
  // Returns a flat list of File objects regardless of source: top-level files
  // or a recursive folder (when the browser exposes webkitGetAsEntry).
  const out = []
  if (!dataTransfer?.items) {
    return Array.from(dataTransfer?.files || [])
  }
  for (const item of Array.from(dataTransfer.items)) {
    const entry = item.webkitGetAsEntry?.()
    if (!entry) {
      const f = item.getAsFile()
      if (f) out.push(f)
    } else if (entry.isFile) {
      const f = await new Promise((resolve) => entry.file(resolve))
      if (f) out.push(f)
    } else if (entry.isDirectory) {
      const nested = await collectDirectoryFiles(entry)
      out.push(...nested)
    }
  }
  return out
}

async function collectDirectoryFiles(dirEntry) {
  // Recursive folder walker. readEntries returns paginated chunks of <= 100.
  // Loop a directory until it reports < 100 entries in one batch (the
  // documented "no more" signal).
  const files = []
  const queue = [dirEntry]
  while (queue.length > 0) {
    const cur = queue.shift()
    const reader = cur.createReader()
    while (true) {
      const batch = await new Promise((resolve) => reader.readEntries(resolve))
      if (!batch || batch.length === 0) break
      for (const entry of batch) {
        if (entry.isFile) {
          const file = await new Promise((resolve) => entry.file(resolve))
          if (file) files.push(file)
        } else if (entry.isDirectory) {
          queue.push(entry)
        }
      }
      if (batch.length < 100) break
    }
  }
  return files
}

// ---------- component --------------------------------------------------------

export default function ComplianceImport() {
  const { t } = useLanguage()
  const { user } = useAuth()
  const { success, error: showError } = useToast()
  const navigate = useNavigate()
  const inputRef = useRef(null)

  const fetchOrphans = useCallback(async () => {
    try {
      setLoadingOrphans(true)
      const { data, error } = await supabase
        .from('compliance_item_documents')
        .select(ORPHAN_DOC_LIST_SELECT)
        .is('item_id', null)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      setMigrationNeeded(false)
      setOrphans(data || [])
    } catch (err) {
      if (isImportMigrationError(err)) setMigrationNeeded(true)
      showError(err.message)
    } finally {
      setLoadingOrphans(false)
    }
  }, [showError])

  const { jobs, enqueue, retry, remove, clearCompleted, utils } = useImportJob({
    userEmail: user?.email || '',
    userId: user?.id || null,
    onJobComplete: ({ fileName, docId }) => {
      fetchOrphans()
      success(t('compliance.import.upload_complete', { name: fileName || 'File' }))
      if (docId) {
        // Gentle nudge: scroll orphan list into view after upload.
        requestAnimationFrame(() => {
          document.getElementById('compliance-import-orphans')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        })
      }
    },
    onJobFailed: ({ message }) => {
      if (message) showError(message)
      if (isImportMigrationError({ message })) setMigrationNeeded(true)
    },
  })

  const [dropActive, setDropActive] = useState(false)
  const [orphans, setOrphans] = useState([])
  const [loadingOrphans, setLoadingOrphans] = useState(true)
  const [migrationNeeded, setMigrationNeeded] = useState(false)

  useEffect(() => {
    fetchOrphans()
    const ch = supabase
      .channel('compliance_orphans_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compliance_item_documents' }, (payload) => {
        // Cheap heuristic: re-fetch on any change to orphans.
        if (payload?.new?.item_id === null || payload?.old?.item_id === null) fetchOrphans()
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [fetchOrphans])

  // ---- DnD wiring ----
  const onDragOver = (e) => { e.preventDefault(); setDropActive(true) }
  const onDragLeave = (e) => { e.preventDefault(); setDropActive(false) }
  const onDrop = async (e) => {
    e.preventDefault()
    setDropActive(false)
    try {
      const files = await collectFiles(e.dataTransfer)
      if (files.length > 0) enqueue(files)
      else if (e.dataTransfer.files?.length > 0) enqueue(Array.from(e.dataTransfer.files))
    } catch (err) {
      showError(err.message || 'Failed to read dropped items')
    }
  }
  const onPick = (e) => {
    const fl = e.target.files
    if (!fl || fl.length === 0) return
    enqueue(Array.from(fl))
    e.target.value = ''  // allow re-picking the same files
  }

  const stats = useMemo(() => {
    let total = jobs.length
    let done = 0, failed = 0, running = 0
    for (const j of jobs) {
      if (j.status === 'completed') done++
      else if (j.status === 'failed') failed++
      else if (j.status === 'uploading' || j.status === 'server_pending') running++
    }
    return { total, done, failed, running }
  }, [jobs])

  return (
    <div className="flex flex-col space-y-3 pb-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <button
            type="button"
            onClick={() => navigate(complianceTabPath('dashboard'))}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 flex-shrink-0 mt-0.5"
            aria-label={t('compliance.import.back_to_compliance')}
          >
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">{t('compliance.import.title')}</h1>
            <p className="text-sm text-gray-600">{t('compliance.import.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to={complianceTabPath('documents')} className="btn btn-secondary py-1.5 px-3 text-sm flex items-center gap-1.5">
            <FileText size={16} /> {t('compliance.documentsLibrary.title')}
          </Link>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 px-4 rounded text-sm flex items-center gap-2"
          >
            <Upload size={16} /> {t('compliance.import.add_files')}
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt,application/pdf,image/*,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={onPick}
          />
        </div>
      </div>

      {(!user?.id) && (
        <div className="bg-red-50 border border-red-200 text-red-900 rounded-lg p-4 text-sm">
          {t('compliance.import.sign_in_required')}
        </div>
      )}

      {migrationNeeded && (
        <div className="bg-amber-50 border border-amber-300 text-amber-950 rounded-lg p-4 text-sm">
          <p className="font-semibold">{t('compliance.import.migration_title')}</p>
          <p className="mt-1 text-amber-900">{t('compliance.import.migration_body')}</p>
          <p className="mt-2 text-xs font-mono text-amber-800">
            Supabase/verify_compliance_import.sql → then Supabase/supabase_compliance_import.sql
          </p>
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
          dropActive ? 'border-rose-500 bg-rose-50' : 'border-gray-300 bg-gray-50'
        }`}
      >
        <Package size={36} className={`mx-auto mb-2 ${dropActive ? 'text-rose-500' : 'text-gray-400'}`} />
        <p className="text-sm font-medium text-gray-900">{t('compliance.import.dropzone_title')}</p>
        <p className="text-xs text-gray-500 mt-1">{t('compliance.import.dropzone_help')}</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-3 inline-flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 px-4 rounded text-sm"
        >
          <Upload size={16} /> {t('compliance.import.choose_files')}
        </button>
        <p className="text-[11px] text-gray-400 mt-3">
          {t('compliance.import.parallel', { n: utils.PARALLEL })} ·{' '}
          {t('compliance.import.max_failures', { n: utils.MAX_FAILURES })}
        </p>
      </div>

      {/* Queue */}
      <div className="bg-white shadow-sm rounded border border-gray-200">
        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            {t('compliance.import.queue_title')} ({stats.total})
          </h2>
          <div className="flex items-center gap-3 text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500" /> {t('compliance.import.stats.running', { n: stats.running })}
            </span>
            <span className="inline-flex items-center gap-1">
              <Check size={12} className="text-green-600" /> {t('compliance.import.stats.done', { n: stats.done })}
            </span>
            <span className="inline-flex items-center gap-1">
              <AlertCircle size={12} className="text-red-600" /> {t('compliance.import.stats.failed', { n: stats.failed })}
            </span>
            {stats.done > 0 && (
              <button type="button" onClick={clearCompleted} className="ml-2 text-rose-700 hover:underline">
                {t('compliance.import.clear_completed')}
              </button>
            )}
          </div>
        </div>

        {jobs.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500">
            {t('compliance.import.queue_empty')}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {jobs.map((j) => {
              const tone = STATUS_TONE[j.status] || STATUS_TONE.queued
              return (
                <li key={j.jobId} className="px-4 py-2.5 flex items-center gap-3">
                  <FileText size={18} className="text-gray-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 truncate" title={j.fileName}>{j.fileName}</p>
                      <span className={`inline px-1.5 py-0.5 rounded text-[10px] font-medium ${tone.bg} ${tone.text}`}>
                        {t(`compliance.import.status.${j.status}`)}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500">
                      {utils.bytesFormat(j.sizeBytes)} · {j.mimeType || 'unknown type'}
                    </p>
                    {j.error ? (
                      <p className="text-[11px] text-red-700 mt-0.5">{j.error}</p>
                    ) : (
                      <div className="mt-1 h-1.5 bg-gray-100 rounded overflow-hidden">
                        <div
                          className={`h-full ${j.status === 'failed' ? 'bg-red-400' : j.status === 'completed' ? 'bg-green-500' : 'bg-rose-500'} transition-[width]`}
                          style={{ width: `${Math.max(j.progress || (j.status === 'completed' ? 100 : 0), 4)}%` }}
                        />
                      </div>
                    )}
                    {j.failureCount > 0 && j.status === 'failed' && (
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {t('compliance.import.failure_count', { n: j.failureCount })}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {j.status === 'failed' && (
                      <button
                        type="button"
                        onClick={() => retry(j.jobId)}
                        className="text-xs text-rose-700 hover:underline inline-flex items-center gap-1"
                      >
                        <RefreshCw size={12} /> {t('compliance.import.retry')}
                      </button>
                    )}
                    {j.status === 'completed' && j.docId && (
                      <Link to={`/compliance/review-orphan/${j.docId}`} className="text-xs text-rose-700 hover:underline inline-flex items-center gap-1">
                        {t('compliance.import.open_review')} <ChevronRight size={12} />
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(j.jobId)}
                      className="ml-2 p-1.5 rounded text-gray-500 hover:bg-gray-100"
                      title="Remove from list"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Orphan list */}
      <div id="compliance-import-orphans" className="bg-white shadow-sm rounded border border-gray-200">
        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            {t('compliance.import.orphans_title')} ({orphans.length})
          </h2>
          <button
            type="button"
            onClick={fetchOrphans}
            className="text-xs text-gray-600 hover:underline inline-flex items-center gap-1"
          >
            <RefreshCw size={12} /> {t('common.refresh')}
          </button>
        </div>
        {loadingOrphans ? (
          <LoadingSpinner />
        ) : orphans.length === 0 ? (
          <EmptyState icon="default" title={t('compliance.import.no_orphans')} />
        ) : (
          <ul className="divide-y divide-gray-100">
            {orphans.map((o) => (
              <li key={o.id} className="px-4 py-2.5 flex items-center gap-3">
                <FileText size={18} className="text-gray-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 truncate" title={o.file_name}>{o.file_name}</p>
                    <span className={`inline px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_TONE[o.processing_status]?.bg || 'bg-gray-100'} ${STATUS_TONE[o.processing_status]?.text || 'text-gray-700'}`}>
                      {t(`compliance.processing.${o.processing_status || 'uploaded'}`)}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500">
                    {utils.bytesFormat(o.size_bytes)} · {new Date(o.created_at).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(`/compliance/review-orphan/${o.id}`)}
                  className="text-xs text-rose-700 hover:underline inline-flex items-center gap-1"
                >
                  {t('compliance.import.review_orphan')} <ChevronRight size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}