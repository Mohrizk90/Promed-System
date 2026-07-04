// Per-item expenses. Mirrors the inline list style of liability_payments.
import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { useLanguage } from '../../context/LanguageContext'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import Dropdown from '../ui/Dropdown'
import { Plus, MoreVertical, Trash2 } from '../ui/Icons'
import { EXPENSE_TYPES } from '../../utils/complianceStatus'

const EMPTY = {
  expense_type: 'government_fee',
  amount: '',
  currency: 'EGP',
  expense_date: new Date().toISOString().split('T')[0],
  vendor: '',
  reference_number: '',
  notes: '',
}

export default function ComplianceItemExpenses({ itemId }) {
  const { t, language } = useLanguage()
  const { user } = useAuth()
  const { success, error: showError } = useToast()
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [formData, setFormData] = useState(EMPTY)
  const [submitting, setSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const fetchExpenses = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('compliance_item_expenses')
        .select('*')
        .eq('item_id', itemId)
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      setExpenses(data || [])
    } catch (err) {
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!itemId) return
    fetchExpenses()
    const ch = supabase
      .channel(`compliance_expenses_${itemId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compliance_item_expenses', filter: `item_id=eq.${itemId}` }, () => fetchExpenses())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [itemId])

  const total = useMemo(() => expenses.reduce((s, e) => s + Number(e.amount || 0), 0), [expenses])
  const currency = useMemo(() => expenses[0]?.currency || 'EGP', [expenses])

  const logEvent = async (eventType, payload) => {
    try {
      await supabase.from('compliance_item_events').insert([{
        item_id: itemId,
        event_type: eventType,
        actor_email: user?.email || null,
        payload,
      }])
    } catch (_) { /* best effort */ }
  }

  const openAdd = () => { setFormData(EMPTY); setShowModal(true) }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const amount = parseFloat(formData.amount)
    if (isNaN(amount) || amount < 0) {
      showError(t('liabilities.invalidAmount'))
      return
    }
    try {
      setSubmitting(true)
      const payload = {
        item_id: itemId,
        expense_type: formData.expense_type,
        amount,
        currency: formData.currency || 'EGP',
        expense_date: formData.expense_date,
        vendor: formData.vendor.trim() || null,
        reference_number: formData.reference_number.trim() || null,
        notes: formData.notes.trim() || null,
        user_id: user?.id || null,
      }
      const { error } = await supabase.from('compliance_item_expenses').insert([payload])
      if (error) throw error
      await logEvent('fee_paid', { amount, expense_type: formData.expense_type })
      success(t('compliance.expense_created'))
      setShowModal(false)
    } catch (err) {
      showError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      setDeleting(true)
      const { error } = await supabase.from('compliance_item_expenses').delete().eq('id', deleteTarget.id)
      if (error) throw error
      success(t('compliance.expense_deleted'))
      setDeleteTarget(null)
    } catch (err) {
      showError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const formatNum = (n) => (Number(n) ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })

  if (loading) return <p className="text-sm text-gray-500 py-4">{t('common.loading')}</p>

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={openAdd}
          className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 px-4 rounded text-sm flex items-center gap-2"
        >
          <Plus size={16} />
          {t('compliance.addExpense')}
        </button>
        <div className="text-sm font-medium text-gray-700">
          {t('compliance.totalExpenses')}: <span className="text-gray-900 tabular-nums">{currency} {formatNum(total)}</span>
        </div>
      </div>

      {expenses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed border-gray-200 rounded">
          <p className="text-sm text-gray-500">{t('compliance.noExpenses')}</p>
        </div>
      ) : (
        <div className="bg-white shadow-sm border border-gray-200 rounded overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1.5 text-left font-semibold text-gray-700 uppercase rtl-flip">{t('compliance.expenseDate')}</th>
                <th className="px-2 py-1.5 text-left font-semibold text-gray-700 uppercase rtl-flip">{t('compliance.expenseType')}</th>
                <th className="px-2 py-1.5 text-left font-semibold text-gray-700 uppercase rtl-flip">{t('compliance.expenseVendor')}</th>
                <th className="px-2 py-1.5 text-left font-semibold text-gray-700 uppercase rtl-flip">{t('compliance.reference_number')}</th>
                <th className="px-2 py-1.5 text-right font-semibold text-gray-700 uppercase rtl-flip">{t('compliance.expenseAmount')}</th>
                <th className="px-2 py-1.5 rtl-flip w-10 print:hidden">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {expenses.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap rtl-flip">{e.expense_date}</td>
                  <td className="px-2 py-1.5 rtl-flip">
                    <span className="inline px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-100 text-rose-700">
                      {t(`compliance.expenseType_${e.expense_type}`)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-gray-700 rtl-flip whitespace-nowrap">{e.vendor || '–'}</td>
                  <td className="px-2 py-1.5 text-gray-700 rtl-flip whitespace-nowrap">{e.reference_number || '–'}</td>
                  <td className="px-2 py-1.5 text-right text-gray-900 tabular-nums whitespace-nowrap rtl-flip">
                    {e.currency || 'EGP'} {formatNum(e.amount)}
                  </td>
                  <td className="px-2 py-1.5 rtl-flip print:hidden whitespace-nowrap">
                    <Dropdown
                      trigger={<MoreVertical size={18} />}
                      align="right"
                      className="inline-block"
                      items={[
                        { label: t('common.delete'), icon: Trash2, danger: true, onClick: () => setDeleteTarget(e) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t border-gray-200">
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right text-sm font-medium text-gray-700 rtl-flip">{t('compliance.totalExpenses')}</td>
                <td className="px-2 py-1.5 text-right text-sm font-semibold text-gray-900 tabular-nums rtl-flip">
                  {currency} {formatNum(total)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={t('compliance.addExpense')}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" form="expense-form" className="btn btn-primary" disabled={submitting}>
              {submitting ? t('common.loading') : t('common.save')}
            </button>
          </div>
        }
      >
        <form id="expense-form" onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">{t('compliance.expenseType')}</label>
              <select className="input w-full py-2 text-sm" value={formData.expense_type} onChange={(e) => setFormData({ ...formData, expense_type: e.target.value })}>
                {EXPENSE_TYPES.map((k) => <option key={k} value={k}>{t(`compliance.expenseType_${k}`)}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs">{t('compliance.expenseDate')}</label>
              <input type="date" className="input w-full py-2 text-sm" value={formData.expense_date} onChange={(e) => setFormData({ ...formData, expense_date: e.target.value })} required />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">{t('compliance.expenseAmount')}</label>
              <input type="number" min="0" step="0.01" className="input w-full py-2 text-sm" value={formData.amount} onChange={(e) => setFormData({ ...formData, amount: e.target.value })} required />
            </div>
            <div>
              <label className="label text-xs">{t('common.currency')}</label>
              <input type="text" className="input w-full py-2 text-sm" value={formData.currency} onChange={(e) => setFormData({ ...formData, currency: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label text-xs">{t('compliance.expenseVendor')}</label>
            <input type="text" className="input w-full py-2 text-sm" value={formData.vendor} onChange={(e) => setFormData({ ...formData, vendor: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">{t('compliance.reference_number')}</label>
            <input type="text" className="input w-full py-2 text-sm" value={formData.reference_number} onChange={(e) => setFormData({ ...formData, reference_number: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">{t('compliance.notes')}</label>
            <textarea className="input w-full py-2 text-sm min-h-[50px] resize-y" value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={2} />
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t('common.deleteConfirmTitle')}
        message={t('compliance.deleteExpenseConfirm')}
        confirmLabel={t('common.delete')}
        isLoading={deleting}
        variant="danger"
      />
    </div>
  )
}