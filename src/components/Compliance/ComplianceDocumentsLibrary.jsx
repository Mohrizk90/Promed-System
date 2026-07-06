// Module-level Documents tab: every document across every item with search,
// filters, paginated table.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useLanguage } from '../../context/LanguageContext'
import { useToast } from '../../context/ToastContext'
import { useComplianceDocuments, useComplianceDocumentTags } from '../../hooks/useComplianceDocuments'
import { useComplianceAuthorities } from '../../hooks/useComplianceItems'
import { deleteComplianceDocuments } from '../../utils/complianceDocumentDelete'
import LoadingSpinner from '../LoadingSpinner'
import EmptyState from '../ui/EmptyState'
import ConfirmDialog from '../ui/ConfirmDialog'
import Pagination from '../ui/Pagination'
import Dropdown from '../ui/Dropdown'
import { getPaginationPrefs, setPaginationPrefs } from '../../utils/paginationPrefs'
import { downloadCsv } from '../../utils/exportCsv'
import {
  PROCESSING_STATES, REVIEW_STATES, processingColor, reviewColor, formatConfidence,
} from '../../utils/documentProcessing'
import { Filter, Download, Upload, FileText, FolderOpen, ClipboardList, MoreVertical, Trash2 } from '../ui/Icons'
import ComplianceFolderBrowser from './ComplianceFolderBrowser'
import {
  groupIntoFolders, documentFolderKey, loadViewMode, saveViewMode, VIEW_MODE_KEY_DOCS,
} from '../../utils/complianceFolders'

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]
const ROUTE_KEY = 'compliance_documents_library'

export default function ComplianceDocumentsLibrary() {
  const { t } = useLanguage()
  const { success, error: showError } = useToast()
  const navigate = useNavigate()
  const [filters, setFilters] = useState({
    search: '',
    authority: 'all',
    documentType: 'all',
    processingStatus: 'all',
    reviewStatus: 'all',
    tag: 'all',
    dateFrom: '',
    dateTo: '',
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [viewMode, setViewMode] = useState(() => loadViewMode(VIEW_MODE_KEY_DOCS))
  const [selectedFolder, setSelectedFolder] = useState(null)
  const [folderSearch, setFolderSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const { docs, loading, refresh } = useComplianceDocuments({ filters })
  const { tags } = useComplianceDocumentTags()
  const { authorities } = useComplianceAuthorities()

  useEffect(() => {
    const prefs = getPaginationPrefs(ROUTE_KEY)
    if (prefs && PAGE_SIZE_OPTIONS.includes(prefs.pageSize)) {
      setPageSize(prefs.pageSize); setPage(prefs.page)
    }
  }, [])

  const documentTypes = useMemo(() => {
    const s = new Set(docs.map((d) => d.document_type).filter(Boolean))
    return Array.from(s)
  }, [docs])

  const totalPages = Math.max(1, Math.ceil(docs.length / pageSize))
  const effectivePage = Math.min(page, totalPages)
  const paginated = useMemo(() => {
    const start = (effectivePage - 1) * pageSize
    return docs.slice(start, start + pageSize)
  }, [docs, effectivePage, pageSize])

  const goToPage = (p) => { setPage(p); setPaginationPrefs(ROUTE_KEY, { page: p, pageSize }) }
  const changePageSize = (s) => { setPageSize(s); setPage(1); setPaginationPrefs(ROUTE_KEY, { page: 1, pageSize: s }) }

  const setF = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); setSelectedIds(new Set()) }

  const failedInView = useMemo(() => docs.filter((d) => d.processing_status === 'failed'), [docs])
  const showBulkBar = filters.processingStatus === 'failed' || failedInView.length > 0

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const deleteDocs = async (list) => {
    if (!list?.length) return
    try {
      setBulkDeleting(true)
      await deleteComplianceDocuments(list)
      success(t('compliance.bulk.deleted_count', { count: list.length }))
      setSelectedIds(new Set())
      setDeleteTarget(null)
      refresh()
    } catch (err) {
      showError(err.message)
    } finally {
      setBulkDeleting(false)
    }
  }

  const folders = useMemo(() => groupIntoFolders(docs, documentFolderKey), [docs])

  const setView = (mode) => {
    setViewMode(mode)
    saveViewMode(VIEW_MODE_KEY_DOCS, mode)
    setSelectedFolder(null)
    setFolderSearch('')
  }

  const docFolderRender = useMemo(() => ({
    key: (d) => d.id,
    matchesSearch: (d, q) => (
      (d.file_name || '').toLowerCase().includes(q)
      || (d.compliance_items?.title || '').toLowerCase().includes(q)
      || (d.document_type || '').toLowerCase().includes(q)
    ),
    render: (d, chevron) => {
      const pc = processingColor(d.processing_status)
      const rc = reviewColor(d.review_status)
      return (
        <button
          type="button"
          onClick={() => navigate(d.compliance_items?.id
            ? `/compliance/item/${d.compliance_items.id}?doc=${d.id}`
            : `/compliance/review-orphan/${d.id}`)}
          className="w-full flex items-center gap-3 px-4 py-3 text-start hover:bg-gray-50 transition-colors"
        >
          <FileText size={18} className="text-gray-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 truncate">{d.file_name}</p>
            <p className="text-xs text-gray-500 truncate mt-0.5">
              {d.compliance_items?.title || t('compliance.folders.unfiled')}
            </p>
            <div className="flex flex-wrap items-center gap-1 mt-1">
              <span className={`inline px-1.5 py-0.5 rounded text-[10px] font-medium ${pc.bg} ${pc.text}`}>
                {t(`compliance.processing.${d.processing_status}`)}
              </span>
              <span className={`inline px-1.5 py-0.5 rounded text-[10px] font-medium ${rc.bg} ${rc.text}`}>
                {t(`compliance.review.status_${d.review_status}`)}
              </span>
            </div>
          </div>
          {chevron}
        </button>
      )
    },
  }), [navigate, t])

  const handleExport = () => {
    const rows = docs.map((d) => ({
      Title: d.file_name,
      Authority: d.compliance_items?.compliance_authorities?.name || '',
      'Document type': d.document_type || '',
      Processing: d.processing_status,
      Review: d.review_status,
      Confidence: formatConfidence(d.confidence_score),
      Item: d.compliance_items?.title || '',
      Tags: (d.compliance_document_tag_assignments || []).map((a) => a.compliance_document_tags?.name).join('|'),
      Uploaded: d.created_at,
    }))
    downloadCsv('compliance-documents.csv', rows)
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="flex flex-col space-y-3 pb-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 print:hidden">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{t('compliance.documentsLibrary.title')}</h2>
          <p className="text-sm text-gray-600">{t('compliance.folders.documents_subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
            <button
              type="button"
              onClick={() => setView('folders')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${viewMode === 'folders' ? 'bg-white shadow text-rose-700' : 'text-gray-600'}`}
            >
              <FolderOpen size={14} /> {t('compliance.view.folders')}
            </button>
            <button
              type="button"
              onClick={() => setView('table')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${viewMode === 'table' ? 'bg-white shadow text-rose-700' : 'text-gray-600'}`}
            >
              <ClipboardList size={14} /> {t('compliance.view.table')}
            </button>
          </div>
          <Link
            to="/compliance"
            className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 px-3 rounded-lg text-sm flex items-center gap-2 shadow-sm"
          >
            <Upload size={16} />
            {t('compliance.workflow.upload_title')}
          </Link>
          <button
            type="button"
            onClick={handleExport}
            disabled={docs.length === 0}
            className="btn btn-secondary flex items-center gap-2 py-1.5 px-3 text-sm"
          >
            <Download size={18} />
            {t('common.exportCsv')}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 print:hidden">
        {[
          { id: 'all', label: t('compliance.all'), patch: { processingStatus: 'all', reviewStatus: 'all' } },
          { id: 'attention', label: t('compliance.documentsLibrary.unlinked'), patch: { processingStatus: 'waiting_for_review', reviewStatus: 'all' } },
          { id: 'processing', label: t('compliance.workflow.col_processing'), patch: { processingStatus: 'ocr_processing', reviewStatus: 'all' } },
          { id: 'approved', label: t('compliance.review.status_approved'), patch: { processingStatus: 'all', reviewStatus: 'approved' } },
          { id: 'failed', label: t('compliance.processing.failed'), patch: { processingStatus: 'failed', reviewStatus: 'all' } },
        ].map((preset) => {
          const active = preset.id === 'all'
            ? filters.processingStatus === 'all' && filters.reviewStatus === 'all'
            : preset.id === 'attention'
              ? filters.processingStatus === 'waiting_for_review'
              : preset.id === 'processing'
                ? filters.processingStatus === 'ocr_processing'
                : preset.id === 'failed'
                  ? filters.processingStatus === 'failed'
                  : filters.reviewStatus === 'approved'
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => setF(preset.patch)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                active ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-gray-600 border-gray-200 hover:border-rose-200'
              }`}
            >
              {preset.label}
            </button>
          )
        })}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 print:hidden">
        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Filter size={16} className="text-gray-500" />
            {viewMode === 'folders' ? t('compliance.folders.quick_filters') : t('common.filters')}
          </h3>
        </div>
        <div className="p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px] flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">{t('compliance.documentsLibrary.search_placeholder')}</label>
            <input type="search" className="input py-2 text-sm w-full rounded-lg border-gray-300" value={filters.search} onChange={(e) => setF({ search: e.target.value })} placeholder={t('compliance.documentsLibrary.search_placeholder')} />
          </div>
          {viewMode === 'table' && (
          <>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">{t('compliance.documentsLibrary.filter_authority')}</label>
            <select className="input py-2 text-sm w-44 rounded-lg border-gray-300" value={filters.authority} onChange={(e) => setF({ authority: e.target.value })}>
              <option value="all">{t('compliance.all')}</option>
              {authorities.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">{t('compliance.documentsLibrary.filter_type')}</label>
            <select className="input py-2 text-sm w-40 rounded-lg border-gray-300" value={filters.documentType} onChange={(e) => setF({ documentType: e.target.value })}>
              <option value="all">{t('compliance.all')}</option>
              {documentTypes.map((tp) => <option key={tp} value={tp}>{tp}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">{t('compliance.documentsLibrary.filter_processing')}</label>
            <select className="input py-2 text-sm w-44 rounded-lg border-gray-300" value={filters.processingStatus} onChange={(e) => setF({ processingStatus: e.target.value })}>
              <option value="all">{t('compliance.all')}</option>
              {PROCESSING_STATES.map((s) => <option key={s} value={s}>{t(`compliance.processing.${s}`)}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">{t('compliance.documentsLibrary.filter_review')}</label>
            <select className="input py-2 text-sm w-32 rounded-lg border-gray-300" value={filters.reviewStatus} onChange={(e) => setF({ reviewStatus: e.target.value })}>
              <option value="all">{t('compliance.all')}</option>
              {REVIEW_STATES.map((s) => <option key={s} value={s}>{t(`compliance.review.status_${s}`)}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">{t('compliance.documentsLibrary.filter_tag')}</label>
            <select className="input py-2 text-sm w-32 rounded-lg border-gray-300" value={filters.tag} onChange={(e) => setF({ tag: e.target.value })}>
              <option value="all">{t('compliance.all')}</option>
              {tags.map((tg) => <option key={tg.id} value={tg.name}>{tg.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">{t('compliance.documentsLibrary.filter_date_from')}</label>
            <input type="date" className="input py-2 text-sm rounded-lg border-gray-300" value={filters.dateFrom} onChange={(e) => setF({ dateFrom: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">{t('compliance.documentsLibrary.filter_date_to')}</label>
            <input type="date" className="input py-2 text-sm rounded-lg border-gray-300" value={filters.dateTo} onChange={(e) => setF({ dateTo: e.target.value })} />
          </div>
          </>
          )}
        </div>
      </div>

      {showBulkBar && viewMode === 'table' && docs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-sm">
          <span className="text-red-900 font-medium">{t('compliance.bulk.failed_documents_hint')}</span>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set(docs.map((d) => d.id)))}
            className="text-xs text-gray-700 hover:underline"
          >
            {t('compliance.bulk.select_all')}
          </button>
          {selectedIds.size > 0 && (
            <button
              type="button"
              disabled={bulkDeleting}
              onClick={() => deleteDocs(docs.filter((d) => selectedIds.has(d.id)))}
              className="text-xs bg-red-600 text-white px-2.5 py-1 rounded font-medium hover:bg-red-700 disabled:opacity-50"
            >
              {t('compliance.bulk.delete_selected', { count: selectedIds.size })}
            </button>
          )}
          {failedInView.length > 0 && (
            <button
              type="button"
              disabled={bulkDeleting}
              onClick={() => deleteDocs(failedInView)}
              className="text-xs text-red-700 hover:underline font-medium"
            >
              {t('compliance.bulk.delete_all_failed')}
            </button>
          )}
        </div>
      )}

      {docs.length === 0 ? (
        <EmptyState icon="default" title={t('compliance.documentsLibrary.no_results')} />
      ) : viewMode === 'folders' ? (
        <ComplianceFolderBrowser
          folders={folders}
          selectedKey={selectedFolder}
          onSelectKey={setSelectedFolder}
          renderItem={docFolderRender}
          searchQuery={folderSearch}
          onSearchChange={setFolderSearch}
          searchPlaceholder={t('compliance.documentsLibrary.search_placeholder')}
          emptyTitle={t('compliance.documentsLibrary.no_results')}
        />
      ) : (
        <>
          <div className="bg-white shadow rounded mt-2 overflow-hidden">
            <table className="w-full table-fixed divide-y divide-gray-200 text-xs">
              <colgroup>
                {showBulkBar && <col style={{ width: '4%' }} />}
                <col style={{ width: showBulkBar ? '32%' : '36%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '6%' }} />
              </colgroup>
              <thead className="bg-gray-100">
                <tr>
                  {showBulkBar && <th className="px-1 py-1.5" />}
                  <th className="px-2 py-1.5 text-start font-semibold text-gray-700 uppercase rtl-flip">{t('compliance.documentsLibrary.column_title')}</th>
                  <th className="px-2 py-1.5 text-start font-semibold text-gray-700 uppercase rtl-flip">{t('compliance.documentsLibrary.column_item')}</th>
                  <th className="px-2 py-1.5 text-start font-semibold text-gray-700 uppercase rtl-flip">{t('compliance.documentsLibrary.column_processing')}</th>
                  <th className="px-2 py-1.5 text-start font-semibold text-gray-700 uppercase rtl-flip hidden md:table-cell">{t('compliance.documentsLibrary.column_type')}</th>
                  <th className="px-2 py-1.5 text-center font-semibold text-gray-700 uppercase rtl-flip print:hidden sticky end-0 bg-gray-100">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {paginated.map((d) => {
                  const pc = processingColor(d.processing_status)
                  const rc = reviewColor(d.review_status)
                  const open = () => navigate(d.compliance_items?.id
                    ? `/compliance/item/${d.compliance_items.id}?doc=${d.id}`
                    : `/compliance/review-orphan/${d.id}`)
                  return (
                    <tr key={d.id} className="hover:bg-gray-50">
                      {showBulkBar && (
                        <td className="px-1 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(d.id)}
                            onChange={() => toggleSelect(d.id)}
                            className="rounded border-gray-300 text-rose-600"
                          />
                        </td>
                      )}
                      <td className="px-2 py-1.5 rtl-flip">
                        <button type="button" onClick={open} className="flex items-start gap-2 min-w-0 text-start w-full hover:text-rose-700">
                          <FileText size={15} className="text-gray-400 flex-shrink-0 mt-0.5" />
                          <span className="min-w-0">
                            <span className="font-medium text-gray-900 block truncate">{d.file_name}</span>
                            {!d.compliance_items?.id && (
                              <span className="text-[10px] text-amber-700">{t('compliance.documentsLibrary.unlinked')}</span>
                            )}
                          </span>
                        </button>
                      </td>
                      <td className="px-2 py-1.5 text-gray-700 rtl-flip truncate">{d.compliance_items?.title || '–'}</td>
                      <td className="px-2 py-1.5 rtl-flip">
                        <div className="flex flex-wrap gap-1">
                          <span className={`inline px-1.5 py-0.5 rounded text-[10px] font-medium ${pc.bg} ${pc.text}`}>
                            {t(`compliance.processing.${d.processing_status}`)}
                          </span>
                          <span className={`inline px-1.5 py-0.5 rounded text-[10px] font-medium ${rc.bg} ${rc.text}`}>
                            {t(`compliance.review.status_${d.review_status}`)}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-gray-700 rtl-flip truncate hidden md:table-cell">{d.document_type || '–'}</td>
                      <td className="px-1 py-1.5 rtl-flip print:hidden text-center sticky end-0 bg-white">
                        <Dropdown
                          trigger={<MoreVertical size={18} />}
                          align="right"
                          items={[
                            { label: t('compliance.documentsLibrary.open'), onClick: open },
                            { divider: true },
                            { label: t('common.delete'), icon: Trash2, danger: true, onClick: () => setDeleteTarget(d) },
                          ]}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={effectivePage}
            totalPages={totalPages}
            onPageChange={goToPage}
            pageSize={pageSize}
            onPageSizeChange={(s) => changePageSize(Number(s))}
            totalItems={docs.length}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
          />
        </>
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteDocs(deleteTarget ? [deleteTarget] : [])}
        title={t('common.deleteConfirmTitle')}
        message={t('compliance.deleteDocumentConfirm')}
        confirmLabel={t('common.delete')}
        isLoading={bulkDeleting}
        variant="danger"
      />
    </div>
  )
}