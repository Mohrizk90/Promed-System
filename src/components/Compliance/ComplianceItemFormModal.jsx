// Form modal for creating / editing a compliance item. Receives authorities
// and categories as props (kept dumb so it can be reused inside the detail page
// for inline edits).
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import { useLanguage } from '../../context/LanguageContext'
import { useAuth } from '../../context/AuthContext'
import Modal from '../ui/Modal'

const EMPTY_FORM = {
  title: '',
  authority_id: '',
  category_id: '',
  status: 'active',
  priority: 'medium',
  owner_email: '',
  reference_number: '',
  description: '',
  notes: '',
  issue_date: '',
  expiry_date: '',
  renewal_period_days: '',
}

export default function ComplianceItemFormModal({
  isOpen,
  onClose,
  onSaved,
  editing,
  authorities = [],
  categories = [],
}) {
  const { t } = useLanguage()
  const { user } = useAuth()
  const { success, error: showError } = useToast()
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (editing) {
      setFormData({
        title: editing.title || '',
        authority_id: editing.authority_id ? String(editing.authority_id) : '',
        category_id: editing.category_id ? String(editing.category_id) : '',
        status: editing.status || 'active',
        priority: editing.priority || 'medium',
        owner_email: editing.owner_email || '',
        reference_number: editing.reference_number || '',
        description: editing.description || '',
        notes: editing.notes || '',
        issue_date: editing.issue_date || '',
        expiry_date: editing.expiry_date || '',
        renewal_period_days: editing.renewal_period_days != null ? String(editing.renewal_period_days) : '',
      })
    } else {
      setFormData(EMPTY_FORM)
    }
    setErrors({})
  }, [editing, isOpen])

  const handleSubmit = async (e) => {
    e.preventDefault()
    const newErrors = {}
    if (!formData.title.trim()) newErrors.title = t('compliance.title_required')
    if (!formData.authority_id) newErrors.authority_id = t('compliance.authority_required')
    if (Object.keys(newErrors).length) { setErrors(newErrors); return }

    try {
      setSubmitting(true)
      const renewal = formData.renewal_period_days ? parseInt(formData.renewal_period_days, 10) : null
      const payload = {
        title: formData.title.trim(),
        authority_id: formData.authority_id ? parseInt(formData.authority_id, 10) : null,
        category_id: formData.category_id ? parseInt(formData.category_id, 10) : null,
        status: formData.status,
        priority: formData.priority,
        owner_email: formData.owner_email.trim() || null,
        reference_number: formData.reference_number.trim() || null,
        description: formData.description.trim() || null,
        notes: formData.notes.trim() || null,
        issue_date: formData.issue_date || null,
        expiry_date: formData.expiry_date || null,
        renewal_period_days: renewal,
        user_id: user?.id || null,
      }
      if (editing) {
        const { error } = await supabase.from('compliance_items').update(payload).eq('id', editing.id)
        if (error) throw error
        success(t('compliance.item_updated'))
      } else {
        const { error } = await supabase.from('compliance_items').insert([payload])
        if (error) throw error
        success(t('compliance.item_created'))
      }
      onSaved?.()
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
      title={editing ? t('compliance.editItem') : t('compliance.addItem')}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="compliance-item-form" className="btn btn-primary" disabled={submitting}>
            {submitting ? t('common.loading') : t('common.save')}
          </button>
        </div>
      }
    >
      <form id="compliance-item-form" onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="label text-xs">{t('compliance.title_field')} <span className="text-red-500">*</span></label>
          <input
            type="text"
            className={`input w-full py-2 text-sm ${errors.title ? 'border-red-500' : ''}`}
            value={formData.title}
            onChange={(e) => { setFormData({ ...formData, title: e.target.value }); setErrors((p) => ({ ...p, title: undefined })) }}
            placeholder={t('compliance.title_placeholder')}
            required
          />
          {errors.title && <p className="text-xs text-red-600 mt-0.5">{errors.title}</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label text-xs">{t('compliance.authority')} <span className="text-red-500">*</span></label>
            <select
              className={`input w-full py-2 text-sm ${errors.authority_id ? 'border-red-500' : ''}`}
              value={formData.authority_id}
              onChange={(e) => setFormData({ ...formData, authority_id: e.target.value })}
              required
            >
              <option value="">{t('compliance.authority_placeholder')}</option>
              {authorities.map((a) => (
                <option key={a.id} value={a.id}>{a.name}{a.country ? ` (${a.country})` : ''}</option>
              ))}
            </select>
            {errors.authority_id && <p className="text-xs text-red-600 mt-0.5">{errors.authority_id}</p>}
          </div>
          <div>
            <label className="label text-xs">{t('compliance.category')}</label>
            <select
              className="input w-full py-2 text-sm"
              value={formData.category_id}
              onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
            >
              <option value="">{t('compliance.category_placeholder')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="label text-xs">{t('compliance.status')}</label>
            <select className="input w-full py-2 text-sm" value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })}>
              <option value="active">{t('compliance.status_active')}</option>
              <option value="expired">{t('compliance.status_expired')}</option>
              <option value="pending_renewal">{t('compliance.status_pending_renewal')}</option>
              <option value="archived">{t('compliance.status_archived')}</option>
            </select>
          </div>
          <div>
            <label className="label text-xs">{t('compliance.priority')}</label>
            <select className="input w-full py-2 text-sm" value={formData.priority} onChange={(e) => setFormData({ ...formData, priority: e.target.value })}>
              <option value="low">{t('compliance.priority_low')}</option>
              <option value="medium">{t('compliance.priority_medium')}</option>
              <option value="high">{t('compliance.priority_high')}</option>
              <option value="critical">{t('compliance.priority_critical')}</option>
            </select>
          </div>
          <div>
            <label className="label text-xs">{t('compliance.owner')}</label>
            <input
              type="text"
              className="input w-full py-2 text-sm"
              value={formData.owner_email}
              onChange={(e) => setFormData({ ...formData, owner_email: e.target.value })}
              placeholder={t('compliance.owner_placeholder')}
            />
          </div>
        </div>

        <div>
          <label className="label text-xs">{t('compliance.reference_number')}</label>
          <input
            type="text"
            className="input w-full py-2 text-sm"
            value={formData.reference_number}
            onChange={(e) => setFormData({ ...formData, reference_number: e.target.value })}
            placeholder={t('compliance.reference_number_placeholder')}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="label text-xs">{t('compliance.issue_date')}</label>
            <input
              type="date"
              className="input w-full py-2 text-sm"
              value={formData.issue_date}
              onChange={(e) => setFormData({ ...formData, issue_date: e.target.value })}
            />
          </div>
          <div>
            <label className="label text-xs">{t('compliance.expiry_date')}</label>
            <input
              type="date"
              className="input w-full py-2 text-sm"
              value={formData.expiry_date}
              onChange={(e) => setFormData({ ...formData, expiry_date: e.target.value })}
            />
          </div>
          <div>
            <label className="label text-xs">{t('compliance.renewal_period')}</label>
            <input
              type="number"
              min="1"
              className="input w-full py-2 text-sm"
              value={formData.renewal_period_days}
              onChange={(e) => setFormData({ ...formData, renewal_period_days: e.target.value })}
              placeholder={t('compliance.renewal_period_placeholder')}
            />
          </div>
        </div>

        <div>
          <label className="label text-xs">{t('compliance.description')}</label>
          <textarea
            className="input w-full py-2 text-sm min-h-[60px] resize-y"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder={t('compliance.description_placeholder')}
            rows={2}
          />
        </div>
        <div>
          <label className="label text-xs">{t('compliance.notes')}</label>
          <textarea
            className="input w-full py-2 text-sm min-h-[50px] resize-y"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            placeholder={t('compliance.notes_placeholder')}
            rows={2}
          />
        </div>
      </form>
    </Modal>
  )
}