// Authorities management tab. Reuses Modal/FormModal/ConfirmDialog patterns
// from Liabilities.jsx.
import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import { useLanguage } from '../../context/LanguageContext'
import { useAuth } from '../../context/AuthContext'
import LoadingSpinner from '../LoadingSpinner'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import EmptyState from '../ui/EmptyState'
import Dropdown from '../ui/Dropdown'
import { Plus, Edit as EditIcon, Trash2, MoreVertical } from '../ui/Icons'
import { useComplianceAuthorities } from './useComplianceAuthorities'
import { useComplianceItems } from './useComplianceItems'

const EMPTY_FORM = { name: '', code: '', country: '', description: '' }

function AuthorityFormModal({ isOpen, onClose, onSaved, editing }) {
  const { t } = useLanguage()
  const { user } = useAuth()
  const { success, error: showError } = useToast()
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (editing) {
      setFormData({
        name: editing.name || '',
        code: editing.code || '',
        country: editing.country || '',
        description: editing.description || '',
      })
    } else {
      setFormData(EMPTY_FORM)
    }
  }, [editing, isOpen])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.name.trim()) {
      showError(t('compliance.authority_name') + ' is required')
      return
    }
    try {
      setSubmitting(true)
      const payload = {
        name: formData.name.trim(),
        code: formData.code.trim() || null,
        country: formData.country.trim() || null,
        description: formData.description.trim() || null,
        color: editing?.color || 'rose',
        user_id: user?.id || null,
      }
      if (editing) {
        const { error } = await supabase
          .from('compliance_authorities')
          .update(payload)
          .eq('id', editing.id)
        if (error) throw error
        success(t('compliance.authority_updated'))
      } else {
        const { error } = await supabase.from('compliance_authorities').insert([payload])
        if (error) throw error
        success(t('compliance.authority_created'))
      }
      onSaved()
      onClose()
    } catch (err) {
      showError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editing ? t('compliance.editAuthority') : t('compliance.addAuthority')}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="authority-form" className="btn btn-primary" disabled={submitting}>
            {submitting ? t('common.loading') : t('common.save')}
          </button>
        </div>
      }
    >
      <form id="authority-form" onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="label text-xs">{t('compliance.authority_name')} <span className="text-red-500">*</span></label>
          <input
            type="text"
            className="input w-full py-2 text-sm"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder={t('compliance.authority_name_placeholder')}
            required
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label text-xs">{t('compliance.authority_code')}</label>
            <input
              type="text"
              className="input w-full py-2 text-sm"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value })}
            />
          </div>
          <div>
            <label className="label text-xs">{t('compliance.authority_country')}</label>
            <input
              type="text"
              className="input w-full py-2 text-sm"
              value={formData.country}
              onChange={(e) => setFormData({ ...formData, country: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className="label text-xs">{t('compliance.authority_description')}</label>
          <textarea
            className="input w-full py-2 text-sm min-h-[60px] resize-y"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={2}
          />
        </div>
      </form>
    </Modal>
  )
}

export default function ComplianceAuthorityManager() {
  const { t } = useLanguage()
  const { success, error: showError } = useToast()
  const { authorities, loading: loadingAuthorities } = useComplianceAuthorities()
  const { items } = useComplianceItems()
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const usageCount = useMemo(() => {
    const map = new Map()
    for (const it of items) {
      if (it.authority_id != null) {
        map.set(it.authority_id, (map.get(it.authority_id) || 0) + 1)
      }
    }
    return map
  }, [items])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return authorities
    return authorities.filter((a) =>
      (a.name || '').toLowerCase().includes(q) ||
      (a.code || '').toLowerCase().includes(q) ||
      (a.country || '').toLowerCase().includes(q)
    )
  }, [authorities, searchQuery])

  const openAdd = () => { setEditing(null); setShowModal(true) }
  const openEdit = (row) => { setEditing(row); setShowModal(true) }

  const handleDelete = async () => {
    if (!deleteTarget) return
    const count = usageCount.get(deleteTarget.id) || 0
    if (count > 0) {
      showError(t('compliance.deleteAuthorityBlocked', { count }))
      setDeleteTarget(null)
      return
    }
    try {
      setDeleting(true)
      const { error } = await supabase.from('compliance_authorities').delete().eq('id', deleteTarget.id)
      if (error) throw error
      success(t('compliance.authority_deleted'))
      setDeleteTarget(null)
    } catch (err) {
      showError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  if (loadingAuthorities) return <LoadingSpinner />

  return (
    <div className="flex flex-col space-y-2 pb-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 print:hidden">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{t('compliance.tab_authorities')}</h2>
          <p className="text-sm text-gray-600">{t('compliance.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 px-4 rounded text-sm flex items-center gap-2"
        >
          <Plus size={18} />
          {t('compliance.addAuthority')}
        </button>
      </div>

      {authorities.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 print:hidden p-3">
          <input
            type="search"
            className="input py-2 text-sm w-full sm:w-72"
            placeholder={t('compliance.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      )}

      {authorities.length === 0 ? (
        <EmptyState
          icon="default"
          title={t('compliance.noAuthorities')}
          description={t('compliance.noAuthoritiesHint')}
          actionLabel={t('compliance.addAuthority')}
          onAction={openAdd}
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon="default" title={t('compliance.noMatchingItems')} description={t('compliance.tryDifferentSearch')} />
      ) : (
        <div className="bg-white shadow rounded overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-700 uppercase rtl-flip">{t('compliance.authority_name')}</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700 uppercase rtl-flip">{t('compliance.authority_code')}</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700 uppercase rtl-flip">{t('compliance.authority_country')}</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-700 uppercase rtl-flip">Items</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700 uppercase rtl-flip print:hidden">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filtered.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-900 rtl-flip">
                    <span className="font-medium">{row.name}</span>
                    {row.description && <p className="text-gray-500 mt-0.5 max-w-md truncate" title={row.description}>{row.description}</p>}
                  </td>
                  <td className="px-3 py-2 text-gray-700 rtl-flip whitespace-nowrap">{row.code || '–'}</td>
                  <td className="px-3 py-2 text-gray-700 rtl-flip whitespace-nowrap">{row.country || '–'}</td>
                  <td className="px-3 py-2 text-right text-gray-700 whitespace-nowrap tabular-nums">{usageCount.get(row.id) || 0}</td>
                  <td className="px-3 py-2 rtl-flip print:hidden whitespace-nowrap">
                    <Dropdown
                      trigger={<MoreVertical size={20} />}
                      align="right"
                      className="inline-block"
                      items={[
                        { label: t('common.edit'), icon: EditIcon, onClick: () => openEdit(row) },
                        { divider: true },
                        { label: t('common.delete'), icon: Trash2, danger: true, onClick: () => setDeleteTarget(row) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AuthorityFormModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSaved={() => {}}
        editing={editing}
      />

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t('common.deleteConfirmTitle')}
        message={t('compliance.deleteAuthorityConfirm')}
        confirmLabel={t('common.delete')}
        isLoading={deleting}
        variant="danger"
      />
    </div>
  )
}