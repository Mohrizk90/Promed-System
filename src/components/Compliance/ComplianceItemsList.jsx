// Items list with filters / sort / pagination, modeled on Liabilities.jsx.
import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import { useLanguage } from '../../context/LanguageContext'
import { getPaginationPrefs, setPaginationPrefs } from '../../utils/paginationPrefs'
import { downloadCsv } from '../../utils/exportCsv'
import LoadingSpinner from '../LoadingSpinner'
import EmptyState from '../ui/EmptyState'
import ConfirmDialog from '../ui/ConfirmDialog'
import Pagination from '../ui/Pagination'
import Dropdown from '../ui/Dropdown'
import { Plus, Download, ChevronDown, ChevronUp, Edit as EditIcon, Trash2, Filter, MoreVertical } from '../ui/Icons'
import { useComplianceItems } from './useComplianceItems'
import { useComplianceAuthorities, useComplianceCategories } from './useComplianceAuthorities'
import {
  STATUS_KEYS, PRIORITY_KEYS,
  computeStatus, formatRemaining, statusColor, priorityColor,
} from '../../utils/complianceStatus'
import ComplianceItemFormModal from './ComplianceItemFormModal'
import ComplianceFolderBrowser from './ComplianceFolderBrowser'
import {
  groupIntoFolders, itemFolderKey, loadViewMode, saveViewMode, VIEW_MODE_KEY_ITEMS,
} from '../../utils/complianceFolders'
import { FolderOpen, ClipboardList } from '../ui/Icons'

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]
const ROUTE_KEY = 'compliance_items'

export default function ComplianceItemsList() {
  const { t, language } = useLanguage()
  const navigate = useNavigate()
  const { success, error: showError } = useToast()
  const { items, loading } = useComplianceItems()
  const { authorities } = useComplianceAuthorities()
  const { categories } = useComplianceCategories()

  const [searchQuery, setSearchQuery] = useState('')
  const [authorityFilter, setAuthorityFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [sortBy, setSortBy] = useState('expiry_date')
  const [sortAsc, setSortAsc] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [viewMode, setViewMode] = useState(() => loadViewMode(VIEW_MODE_KEY_ITEMS))
  const [selectedFolder, setSelectedFolder] = useState(null)
  const [folderSearch, setFolderSearch] = useState('')

  // Hydrate page + pageSize from localStorage on mount.
  useEffect(() => {
    const prefs = getPaginationPrefs(ROUTE_KEY)
    if (prefs && PAGE_SIZE_OPTIONS.includes(prefs.pageSize)) {
      setPageSize(prefs.pageSize)
      setPage(prefs.page)
    }
  }, [])

  const today = useMemo(() => new Date().toISOString().split('T')[0], [])

  const filtered = useMemo(() => {
    let list = items.map((it) => ({ ...it, derivedStatus: computeStatus(it) }))
    if (authorityFilter !== 'all') list = list.filter((r) => String(r.authority_id) === authorityFilter)
    if (categoryFilter !== 'all') list = list.filter((r) => String(r.category_id) === categoryFilter)
    if (statusFilter !== 'all') list = list.filter((r) => r.derivedStatus === statusFilter)
    if (priorityFilter !== 'all') list = list.filter((r) => r.priority === priorityFilter)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter((r) =>
        (r.title || '').toLowerCase().includes(q) ||
        (r.reference_number || '').toLowerCase().includes(q) ||
        (r.owner_email || '').toLowerCase().includes(q) ||
        (r.notes || '').toLowerCase().includes(q) ||
        (r.compliance_authorities?.name || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [items, authorityFilter, categoryFilter, statusFilter, priorityFilter, searchQuery])

  const sorted = useMemo(() => {
    const list = [...filtered]
    const mult = sortAsc ? 1 : -1
    list.sort((a, b) => {
      let va = a[sortBy]
      let vb = b[sortBy]
      if (sortBy === 'expiry_date' || sortBy === 'issue_date' || sortBy === 'created_at') {
        va = va || '9999-99-99'
        vb = vb || '9999-99-99'
        return mult * String(va).localeCompare(String(vb))
      }
      if (typeof va === 'string' || typeof vb === 'string') {
        va = (va || '').toString()
        vb = (vb || '').toString()
        return mult * va.localeCompare(vb)
      }
      va = Number(va) || 0
      vb = Number(vb) || 0
      return mult * (va - vb)
    })
    return list
  }, [filtered, sortBy, sortAsc])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const effectivePage = Math.min(page, totalPages)
  const paginated = useMemo(() => {
    const start = (effectivePage - 1) * pageSize
    return sorted.slice(start, start + pageSize)
  }, [sorted, effectivePage, pageSize])

  const summary = useMemo(() => {
    const total = sorted.length
    const active = sorted.filter((r) => r.derivedStatus === 'active').length
    const expired = sorted.filter((r) => r.derivedStatus === 'expired').length
    const due = sorted.filter((r) => {
      const rem = daysUntil(r.expiry_date)
      return rem != null && rem >= 0 && rem <= 30
    }).length
    const critical = sorted.filter((r) => r.priority === 'critical').length
    return { total, active, expired, due, critical }
  }, [sorted])

  const folders = useMemo(() => groupIntoFolders(sorted, itemFolderKey), [sorted])

  const setView = (mode) => {
    setViewMode(mode)
    saveViewMode(VIEW_MODE_KEY_ITEMS, mode)
    setSelectedFolder(null)
    setFolderSearch('')
  }

  const itemFolderRender = useMemo(() => ({
    key: (row) => row.id,
    matchesSearch: (row, q) => (
      (row.title || '').toLowerCase().includes(q)
      || (row.reference_number || '').toLowerCase().includes(q)
      || (row.compliance_authorities?.name || '').toLowerCase().includes(q)
      || (row.owner_email || '').toLowerCase().includes(q)
    ),
    render: (row, chevron) => {
      const sc = statusColor(row.derivedStatus)
      const remaining = formatRemaining(row.expiry_date, t)
      return (
        <button
          type="button"
          onClick={() => navigate(`/compliance/item/${row.id}`)}
          className="w-full flex items-center gap-3 px-4 py-3 text-start hover:bg-gray-50 transition-colors"
        >
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 truncate">{row.title}</p>
            <p className="text-xs text-gray-500 truncate mt-0.5">
              {row.compliance_authorities?.name || '–'}
              {row.reference_number ? ` · ${row.reference_number}` : ''}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span className={`inline px-1.5 py-0.5 rounded text-[10px] font-medium ${sc.bg} ${sc.text}`}>
                {t(`compliance.status_${row.derivedStatus}`)}
              </span>
              {remaining && <span className="text-[10px] text-gray-600">{remaining}</span>}
            </div>
          </div>
          {chevron}
        </button>
      )
    },
  }), [navigate, t])

  const toggleSort = (col) => {
    setSortBy(col)
    setSortAsc((prev) => (sortBy === col ? !prev : true))
  }

  const openAdd = () => { setEditing(null); setShowModal(true) }
  const openEdit = (row) => { setEditing(row); setShowModal(true) }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      setDeleting(true)
      const { error } = await supabase.from('compliance_items').delete().eq('id', deleteTarget.id)
      if (error) throw error
      success(t('compliance.item_deleted'))
      setDeleteTarget(null)
    } catch (err) {
      showError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const handleExport = () => {
    const rows = sorted.map((r) => ({
      Title: r.title,
      Authority: r.compliance_authorities?.name || '',
      Category: r.compliance_categories?.name || '',
      Status: r.derivedStatus,
      Priority: r.priority,
      Owner: r.owner_email || '',
      Reference: r.reference_number || '',
      'Issue date': r.issue_date || '',
      'Expiry date': r.expiry_date || '',
      'Renewal (days)': r.renewal_period_days || '',
      Remaining: formatRemaining(r.expiry_date, t) || '',
      Notes: r.notes || '',
    }))
    downloadCsv('compliance-items.csv', rows)
    success(t('common.exportCsv'))
  }

  const goToPage = (p) => { setPage(p); setPaginationPrefs(ROUTE_KEY, { page: p, pageSize }) }
  const changePageSize = (s) => { setPageSize(s); setPage(1); setPaginationPrefs(ROUTE_KEY, { page: 1, pageSize: s }) }

  const formatNum = (n) => (Number(n) ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })

  if (loading) return <LoadingSpinner />

  return (
    <div className="flex flex-col space-y-2 pb-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 print:hidden">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{t('compliance.tab_items')}</h2>
          <p className="text-sm text-gray-600">{t('compliance.folders.items_subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
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
          <button type="button" onClick={handleExport} disabled={sorted.length === 0} className="btn btn-secondary flex items-center gap-2 py-1.5 px-3 text-sm">
            <Download size={18} />
            {t('common.exportCsv')}
          </button>
          <button
            type="button"
            onClick={openAdd}
            className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 px-4 rounded text-sm flex items-center gap-2"
          >
            <Plus size={18} />
            {t('compliance.addItem')}
          </button>
        </div>
      </div>

      {sorted.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 print:hidden">
          <div className="bg-rose-600 text-white p-2.5 rounded shadow">
            <p className="text-xs font-medium">{t('compliance.dashboard_active')}</p>
            <p className="text-lg font-bold">{summary.active} / {summary.total}</p>
          </div>
          <div className="bg-red-600 text-white p-2.5 rounded shadow">
            <p className="text-xs font-medium">{t('compliance.status_expired')}</p>
            <p className="text-lg font-bold">{summary.expired}</p>
          </div>
          <div className="bg-amber-600 text-white p-2.5 rounded shadow">
            <p className="text-xs font-medium">{t('compliance.dashboard_due_soon')}</p>
            <p className="text-lg font-bold">{summary.due}</p>
          </div>
          <div className="bg-orange-600 text-white p-2.5 rounded shadow">
            <p className="text-xs font-medium">{t('compliance.dashboard_critical')}</p>
            <p className="text-lg font-bold">{summary.critical}</p>
          </div>
          <div className="bg-blue-600 text-white p-2.5 rounded shadow">
            <p className="text-xs font-medium">{t('common.total')}</p>
            <p className="text-lg font-bold">{summary.total}</p>
          </div>
        </div>
      )}

      {items.length > 0 && viewMode === 'table' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 print:hidden overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Filter size={16} className="text-gray-500" />
              {t('common.filters')}
            </h3>
          </div>
          <div className="p-4 flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">{t('compliance.filterByAuthority')}</label>
              <select className="input py-2 text-sm w-44 rounded-lg border-gray-300" value={authorityFilter} onChange={(e) => { setAuthorityFilter(e.target.value); setPage(1) }}>
                <option value="all">{t('compliance.all')}</option>
                {authorities.map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">{t('compliance.filterByCategory')}</label>
              <select className="input py-2 text-sm w-44 rounded-lg border-gray-300" value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1) }}>
                <option value="all">{t('compliance.all')}</option>
                {categories.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">{t('compliance.filterByStatus')}</label>
              <select className="input py-2 text-sm w-44 rounded-lg border-gray-300" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
                <option value="all">{t('compliance.all')}</option>
                {STATUS_KEYS.map((k) => <option key={k} value={k}>{t(`compliance.status_${k}`)}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">{t('compliance.filterByPriority')}</label>
              <select className="input py-2 text-sm w-32 rounded-lg border-gray-300" value={priorityFilter} onChange={(e) => { setPriorityFilter(e.target.value); setPage(1) }}>
                <option value="all">{t('compliance.all')}</option>
                {PRIORITY_KEYS.map((k) => <option key={k} value={k}>{t(`compliance.priority_${k}`)}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">{t('common.searchPlaceholder')}</label>
              <input type="search" className="input py-2 text-sm w-56 rounded-lg border-gray-300" placeholder={t('compliance.searchPlaceholder')} value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setPage(1) }} />
            </div>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState icon="default" title={t('compliance.noItems')} description={t('compliance.noItemsHint')} actionLabel={t('compliance.addItem')} onAction={openAdd} />
      ) : sorted.length === 0 ? (
        <EmptyState icon="default" title={t('compliance.noMatchingItems')} description={t('compliance.tryDifferentSearch')} />
      ) : viewMode === 'folders' ? (
        <ComplianceFolderBrowser
          folders={folders}
          selectedKey={selectedFolder}
          onSelectKey={setSelectedFolder}
          renderItem={itemFolderRender}
          searchQuery={folderSearch}
          onSearchChange={setFolderSearch}
          searchPlaceholder={t('compliance.searchPlaceholder')}
          emptyTitle={t('compliance.noMatchingItems')}
          emptyHint={t('compliance.tryDifferentSearch')}
        />
      ) : (
        <>
          <div className="bg-white shadow rounded mt-2 overflow-hidden">
            <table className="w-full table-fixed divide-y divide-gray-200 text-xs">
              <colgroup>
                <col style={{ width: '34%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '6%' }} />
              </colgroup>
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-2 py-1.5 text-start font-semibold text-gray-700 uppercase rtl-flip">
                    <button type="button" onClick={() => toggleSort('title')} className="flex items-center gap-0.5 hover:underline">
                      {t('compliance.title_field')} {sortBy === 'title' && (sortAsc ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                    </button>
                  </th>
                  <th className="px-2 py-1.5 text-start font-semibold text-gray-700 uppercase rtl-flip">{t('compliance.category')}</th>
                  <th className="px-2 py-1.5 text-start font-semibold text-gray-700 uppercase rtl-flip">{t('compliance.status')}</th>
                  <th className="px-2 py-1.5 text-start font-semibold text-gray-700 uppercase rtl-flip">
                    <button type="button" onClick={() => toggleSort('expiry_date')} className="hover:underline">
                      {t('compliance.expiry_date')} {sortBy === 'expiry_date' && (sortAsc ? '↑' : '↓')}
                    </button>
                  </th>
                  <th className="px-2 py-1.5 text-start font-semibold text-gray-700 uppercase rtl-flip hidden sm:table-cell">{t('compliance.owner')}</th>
                  <th className="px-2 py-1.5 text-center font-semibold text-gray-700 uppercase rtl-flip print:hidden sticky end-0 bg-gray-100">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {paginated.map((row) => {
                  const sc = statusColor(row.derivedStatus)
                  const pc = priorityColor(row.priority)
                  const remaining = formatRemaining(row.expiry_date, t)
                  return (
                    <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-2 py-1.5 text-gray-900 rtl-flip">
                        <button type="button" onClick={() => navigate(`/compliance/item/${row.id}`)} className="font-medium hover:underline text-start rtl:text-end block w-full truncate">
                          {row.title}
                        </button>
                        <p className="text-[10px] text-gray-500 truncate">{row.compliance_authorities?.name || '–'}</p>
                        {row.reference_number && <p className="text-[10px] text-gray-400 truncate">{row.reference_number}</p>}
                      </td>
                      <td className="px-2 py-1.5 text-gray-700 rtl-flip truncate">{row.compliance_categories?.name || '–'}</td>
                      <td className="px-2 py-1.5 rtl-flip">
                        <div className="flex flex-wrap gap-1">
                          <span className={`inline px-1.5 py-0.5 rounded text-[10px] font-medium ${sc.bg} ${sc.text}`}>
                            {t(`compliance.status_${row.derivedStatus}`)}
                          </span>
                          <span className={`inline px-1.5 py-0.5 rounded text-[10px] font-medium ${pc.bg} ${pc.text}`}>
                            {t(`compliance.priority_${row.priority}`)}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-gray-700 rtl-flip">
                        <div className="truncate">{row.expiry_date || '–'}</div>
                        <div className="text-[10px] text-gray-500 truncate">{remaining || t('compliance.expiry.noDate')}</div>
                      </td>
                      <td className="px-2 py-1.5 text-gray-700 rtl-flip truncate hidden sm:table-cell" title={row.owner_email}>{row.owner_email || '–'}</td>
                      <td className="px-1 py-1.5 rtl-flip print:hidden text-center sticky end-0 bg-white">
                        <Dropdown
                          trigger={<MoreVertical size={18} />}
                          align="right"
                          className="inline-block"
                          items={[
                            { label: t('entities.viewDetails'), icon: EditIcon, onClick: () => navigate(`/compliance/item/${row.id}`) },
                            { label: t('common.edit'), icon: EditIcon, onClick: () => openEdit(row) },
                            { divider: true },
                            { label: t('common.delete'), icon: Trash2, danger: true, onClick: () => setDeleteTarget(row) },
                          ]}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {sorted.length > 0 && (
            <Pagination
              currentPage={effectivePage}
              totalPages={totalPages}
              onPageChange={goToPage}
              pageSize={pageSize}
              onPageSizeChange={(s) => changePageSize(Number(s))}
              totalItems={sorted.length}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
            />
          )}
        </>
      )}

      <ComplianceItemFormModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        editing={editing}
        authorities={authorities}
        categories={categories}
      />

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t('common.deleteConfirmTitle')}
        message={t('compliance.deleteItemConfirm')}
        confirmLabel={t('common.delete')}
        isLoading={deleting}
        variant="danger"
      />
    </div>
  )
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const target = new Date(dateStr + 'T00:00:00')
  if (isNaN(target.getTime())) return null
  const today = new Date(new Date().toISOString().split('T')[0] + 'T00:00:00')
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}