// Module-level Documents tab: every document across every item with search,
// filters, paginated table.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useLanguage } from '../../context/LanguageContext'
import { useComplianceDocuments, useComplianceDocumentTags } from '../../hooks/useComplianceDocuments'
import { useComplianceAuthorities } from '../../hooks/useComplianceItems'
import LoadingSpinner from '../LoadingSpinner'
import EmptyState from '../ui/EmptyState'
import Pagination from '../ui/Pagination'
import { getPaginationPrefs, setPaginationPrefs } from '../../utils/paginationPrefs'
import { downloadCsv } from '../../utils/exportCsv'
import {
  PROCESSING_STATES, REVIEW_STATES, processingColor, reviewColor,
  formatConfidence, confidenceColor,
} from '../../utils/documentProcessing'
import { Filter, Download, Upload } from '../ui/Icons'

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]
const ROUTE_KEY = 'compliance_documents_library'

export default function ComplianceDocumentsLibrary() {
  const { t } = useLanguage()
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

  const { docs, loading } = useComplianceDocuments({ filters })
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

  const setF = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1) }

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
          <p className="text-sm text-gray-600">{t('compliance.documentsLibrary.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Link
            to="/compliance/import"
            className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 px-3 rounded text-sm flex items-center gap-2"
          >
            <Upload size={16} />
            {t('compliance.import.title')}
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

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 print:hidden">
        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Filter size={16} className="text-gray-500" />
            {t('common.filters')}
          </h3>
        </div>
        <div className="p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px] flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">{t('compliance.documentsLibrary.search_placeholder')}</label>
            <input type="search" className="input py-2 text-sm w-full rounded-lg border-gray-300" value={filters.search} onChange={(e) => setF({ search: e.target.value })} placeholder={t('compliance.documentsLibrary.search_placeholder')} />
          </div>
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
        </div>
      </div>

      {docs.length === 0 ? (
        <EmptyState icon="default" title={t('compliance.documentsLibrary.no_results')} />
      ) : (
        <>
          <div className="bg-white shadow rounded overflow-x-auto overflow-y-visible mt-2">
            <table className="min-w-full divide-y divide-gray-200 text-xs">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold text-gray-700 uppercase rtl-flip">{t('compliance.documentsLibrary.column_title')}</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-gray-700 uppercase rtl-flip">{t('compliance.documentsLibrary.column_authority')}</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-gray-700 uppercase rtl-flip">{t('compliance.documentsLibrary.column_type')}</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-gray-700 uppercase rtl-flip">{t('compliance.documentsLibrary.column_processing')}</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-gray-700 uppercase rtl-flip">{t('compliance.documentsLibrary.column_review')}</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-gray-700 uppercase rtl-flip">{t('compliance.documentsLibrary.column_confidence')}</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-gray-700 uppercase rtl-flip">{t('compliance.documentsLibrary.column_item')}</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {paginated.map((d) => {
                  const pc = processingColor(d.processing_status)
                  const rc = reviewColor(d.review_status)
                  const cc = confidenceColor(d.confidence_score)
                  return (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="px-2 py-1.5 rtl-flip">
                        <button type="button" onClick={() => d.compliance_items?.id && navigate(`/compliance/item/${d.compliance_items.id}?doc=${d.id}`)} className="font-medium text-gray-900 hover:underline text-left rtl:text-right">
                          {d.file_name}
                        </button>
                      </td>
                      <td className="px-2 py-1.5 text-gray-700 rtl-flip whitespace-nowrap">{d.compliance_items?.compliance_authorities?.name || '–'}</td>
                      <td className="px-2 py-1.5 text-gray-700 rtl-flip whitespace-nowrap">{d.document_type || '–'}</td>
                      <td className="px-2 py-1.5 rtl-flip whitespace-nowrap">
                        <span className={`inline px-1.5 py-0.5 rounded text-[10px] font-medium ${pc.bg} ${pc.text}`}>
                          {t(`compliance.processing.${d.processing_status}`)}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 rtl-flip whitespace-nowrap">
                        <span className={`inline px-1.5 py-0.5 rounded text-[10px] font-medium ${rc.bg} ${rc.text}`}>
                          {t(`compliance.review.status_${d.review_status}`)}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 rtl-flip whitespace-nowrap">
                        <span className={`inline px-1.5 py-0.5 rounded text-[10px] font-medium ${cc.bg} ${cc.text}`}>
                          {formatConfidence(d.confidence_score)}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-gray-700 rtl-flip whitespace-nowrap truncate max-w-[160px]" title={d.compliance_items?.title}>
                        {d.compliance_items?.title || '–'}
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
    </div>
  )
}