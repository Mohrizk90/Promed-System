// Detail page for a single compliance item. Header card + tabs:
// Overview | Documents | Tasks | Expenses | Timeline.
import { useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useLanguage } from '../../context/LanguageContext'
import LoadingSpinner from '../LoadingSpinner'
import { ArrowLeft, Edit as EditIcon, Trash2 } from '../ui/Icons'
import { useComplianceItem } from './useComplianceItems'
import { useComplianceAuthorities, useComplianceCategories } from './useComplianceAuthorities'
import { computeStatus, formatRemaining, statusColor, priorityColor } from '../../utils/complianceStatus'
import ComplianceItemDocuments from './ComplianceItemDocuments'
import ComplianceItemTasks from './ComplianceItemTasks'
import ComplianceItemExpenses from './ComplianceItemExpenses'
import ComplianceItemTimeline from './ComplianceItemTimeline'
import ComplianceItemFormModal from './ComplianceItemFormModal'
import ConfirmDialog from '../ui/ConfirmDialog'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'

const TABS = ['overview', 'documents', 'tasks', 'expenses', 'timeline']

export default function ComplianceItemDetail() {
  const { t } = useLanguage()
  const { id } = useParams()
  const navigate = useNavigate()
  const { success, error: showError } = useToast()
  const { item, loading } = useComplianceItem(id)
  const { authorities } = useComplianceAuthorities()
  const { categories } = useComplianceCategories()
  const [tab, setTab] = useState('overview')
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (loading) return <LoadingSpinner />

  if (!item) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-gray-500">Item not found</p>
        <button type="button" onClick={() => navigate('/compliance')} className="mt-3 btn btn-secondary">
          {t('common.cancel')}
        </button>
      </div>
    )
  }

  const derived = computeStatus(item)
  const sc = statusColor(derived)
  const pc = priorityColor(item.priority)

  const handleDelete = async () => {
    try {
      setDeleting(true)
      const { error } = await supabase.from('compliance_items').delete().eq('id', item.id)
      if (error) throw error
      success(t('compliance.item_deleted'))
      navigate('/compliance')
    } catch (err) {
      showError(err.message)
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <div className="flex flex-col space-y-3 pb-4">
      {/* Header */}
      <div className="flex items-start gap-2">
        <button type="button" onClick={() => navigate('/compliance')} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" aria-label={t('common.cancel')}>
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900 truncate">{item.title}</h1>
            <span className={`inline px-2 py-0.5 rounded-full text-xs font-medium ${sc.bg} ${sc.text}`}>
              {t(`compliance.status_${derived}`)}
            </span>
            <span className={`inline px-2 py-0.5 rounded-full text-xs font-medium ${pc.bg} ${pc.text}`}>
              {t(`compliance.priority_${item.priority}`)}
            </span>
          </div>
          <p className="text-sm text-gray-600 mt-1">
            {item.compliance_authorities?.name || '—'}
            {item.compliance_categories?.name ? ` · ${item.compliance_categories.name}` : ''}
            {item.owner_email ? ` · ${item.owner_email}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5 print:hidden">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="btn btn-secondary flex items-center gap-1.5 py-1.5 px-3 text-sm"
          >
            <EditIcon size={16} />
            {t('common.edit')}
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="btn btn-danger flex items-center gap-1.5 py-1.5 px-3 text-sm"
          >
            <Trash2 size={16} />
            {t('common.delete')}
          </button>
        </div>
      </div>

      {/* Quick meta */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div>
          <p className="text-gray-500">{t('compliance.reference_number')}</p>
          <p className="font-medium text-gray-900 truncate" title={item.reference_number}>{item.reference_number || '–'}</p>
        </div>
        <div>
          <p className="text-gray-500">{t('compliance.issue_date')}</p>
          <p className="font-medium text-gray-900">{item.issue_date || '–'}</p>
        </div>
        <div>
          <p className="text-gray-500">{t('compliance.expiry_date')}</p>
          <p className="font-medium text-gray-900">{item.expiry_date || '–'}</p>
        </div>
        <div>
          <p className="text-gray-500">{t('compliance.renewal_period')}</p>
          <p className="font-medium text-gray-900">{item.renewal_period_days ? `${item.renewal_period_days} days` : '–'}</p>
        </div>
        {item.expiry_date && (
          <div className="col-span-2 sm:col-span-4">
            <p className="text-gray-500">{t('compliance.expiry.remaining')}</p>
            <p className={`font-medium ${derived === 'expired' ? 'text-red-600' : derived === 'pending_renewal' ? 'text-amber-700' : 'text-gray-900'}`}>
              {formatRemaining(item.expiry_date, t)}
            </p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 print:hidden">
        <nav className="flex flex-wrap gap-1 -mb-px" aria-label="Item sections">
          {TABS.map((key) => {
            const active = tab === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors rtl-flip ${
                  active
                    ? 'border-rose-600 text-rose-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                {t(`compliance.${key}`)}
              </button>
            )
          })}
        </nav>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 min-h-[200px]">
        {tab === 'overview' && (
          <div className="space-y-4">
            <section>
              <h3 className="text-sm font-semibold text-gray-700 mb-1">{t('compliance.description')}</h3>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{item.description || '–'}</p>
            </section>
            <section>
              <h3 className="text-sm font-semibold text-gray-700 mb-1">{t('compliance.notes')}</h3>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{item.notes || '–'}</p>
            </section>
          </div>
        )}
        {tab === 'documents' && <ComplianceItemDocuments itemId={item.id} />}
        {tab === 'tasks' && <ComplianceItemTasks itemId={item.id} />}
        {tab === 'expenses' && <ComplianceItemExpenses itemId={item.id} />}
        {tab === 'timeline' && <ComplianceItemTimeline itemId={item.id} />}
      </div>

      {editing && (
        <ComplianceItemFormModal
          isOpen={editing}
          onClose={() => setEditing(false)}
          editing={item}
          authorities={authorities}
          categories={categories}
          onSaved={() => setEditing(false)}
        />
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
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