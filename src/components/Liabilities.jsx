import React, { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { useLanguage } from '../context/LanguageContext'
import { getPaginationPrefs, setPaginationPrefs } from '../utils/paginationPrefs'
import LoadingSpinner from './LoadingSpinner'
import EmptyState from './ui/EmptyState'
import Modal from './ui/Modal'
import ConfirmDialog from './ui/ConfirmDialog'
import Pagination from './ui/Pagination'
import { Plus, Edit, Trash2, DollarSign } from './ui/Icons'

const CATEGORY_KEYS = [
  'taxes',
  'tax_accountant',
  'invoices_accountant',
  'municipal',
  'lawyer',
  'salaries',
  'insurance',
  'liabilities',
  'other',
  'custom'
]

function Liabilities() {
  const [liabilities, setLiabilities] = useState([])
  const [supplierPayables, setSupplierPayables] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [editingLiability, setEditingLiability] = useState(null)
  const [paymentLiability, setPaymentLiability] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formData, setFormData] = useState({ category: 'other', description: '', total_amount: '' })
  const [paymentFormData, setPaymentFormData] = useState({ payment_amount: '', payment_date: new Date().toISOString().split('T')[0] })

  const [searchParams, setSearchParams] = useSearchParams()
  const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100]
  const ROUTE_KEY = 'liabilities'

  useEffect(() => {
    if (searchParams.has('pageSize')) return
    const prefs = getPaginationPrefs(ROUTE_KEY)
    if (prefs && PAGE_SIZE_OPTIONS.includes(prefs.pageSize)) {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev)
        p.set('page', String(prefs.page))
        p.set('pageSize', String(prefs.pageSize))
        return p
      })
    }
  }, [])

  const currentPage = Math.max(1, parseInt(searchParams.get('page'), 10) || 1)
  const pageSizeParam = searchParams.get('pageSize')
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(pageSizeParam)) ? Number(pageSizeParam) : 10

  const setPage = (page) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('page', String(page))
      return p
    })
    setPaginationPrefs(ROUTE_KEY, { page, pageSize })
  }
  const setPageSizeAndReset = (size) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('pageSize', String(size))
      p.set('page', '1')
      return p
    })
    setPaginationPrefs(ROUTE_KEY, { page: 1, pageSize: size })
  }

  const { success, error: showError } = useToast()
  const { t } = useLanguage()

  const fetchData = async () => {
    try {
      setLoading(true)
      const [liabResult, supplierResult] = await Promise.all([
        supabase.from('liabilities').select('*').order('created_at', { ascending: false }),
        supabase
          .from('supplier_transactions')
          .select('*, suppliers:supplier_id (supplier_name), products:product_id (product_name)')
          .gt('remaining_amount', 0)
          .order('transaction_date', { ascending: false })
      ])
      if (liabResult.error) throw liabResult.error
      if (supplierResult.error) throw supplierResult.error
      setLiabilities(liabResult.data || [])
      setSupplierPayables(supplierResult.data || [])
    } catch (err) {
      console.error('Error loading liabilities:', err)
      showError('Error loading liabilities: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  // Combined list: liabilities (source: 'liability') + supplier payables (source: 'supplier')
  const combinedList = useMemo(() => {
    const liabilityRows = (liabilities || []).map((l) => ({ ...l, source: 'liability', rowId: `liability-${l.id}` }))
    const supplierRows = (supplierPayables || []).map((st) => ({
      source: 'supplier',
      rowId: `supplier-${st.transaction_id}`,
      transaction_id: st.transaction_id,
      category: 'supplier',
      description: [st.suppliers?.supplier_name, st.products?.product_name, st.transaction_date].filter(Boolean).join(' · ') || '–',
      total_amount: st.total_amount,
      paid_amount: st.paid_amount,
      remaining_amount: st.remaining_amount
    }))
    return [...liabilityRows, ...supplierRows]
  }, [liabilities, supplierPayables])

  const totalAmountSum = useMemo(() => combinedList.reduce((s, l) => s + parseFloat(l.total_amount || 0), 0), [combinedList])
  const paidSum = useMemo(() => combinedList.reduce((s, l) => s + parseFloat(l.paid_amount || 0), 0), [combinedList])
  const remainingSum = useMemo(() => combinedList.reduce((s, l) => s + parseFloat(l.remaining_amount || 0), 0), [combinedList])

  const totalPages = Math.max(1, Math.ceil(combinedList.length / pageSize))
  const effectivePage = Math.min(currentPage, totalPages)
  const paginatedList = useMemo(() => {
    const start = (effectivePage - 1) * pageSize
    return combinedList.slice(start, start + pageSize)
  }, [combinedList, effectivePage, pageSize])

  const openAdd = () => {
    setEditingLiability(null)
    setFormData({ category: 'other', description: '', total_amount: '' })
    setShowModal(true)
  }

  const openEdit = (row) => {
    if (row.source === 'supplier') return
    setEditingLiability(row)
    setFormData({
      category: row.category || 'other',
      description: row.description || '',
      total_amount: String(row.total_amount ?? '')
    })
    setShowModal(true)
  }

  const openPayment = (row) => {
    setPaymentLiability(row)
    setPaymentFormData({ payment_amount: '', payment_date: new Date().toISOString().split('T')[0] })
    setShowPaymentModal(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const description = formData.description.trim()
    if (!description) {
      showError(t('liabilities.descriptionRequired'))
      return
    }
    const total = parseFloat(formData.total_amount)
    if (isNaN(total) || total < 0) {
      showError(t('liabilities.invalidAmount'))
      return
    }
    const category = formData.category
    try {
      setSubmitting(true)
      if (editingLiability) {
        const paid = parseFloat(editingLiability.paid_amount || 0)
        const remaining = Math.max(0, total - paid)
        const { error } = await supabase
          .from('liabilities')
          .update({
            category,
            description: description || null,
            total_amount: total,
            paid_amount: paid,
            remaining_amount: remaining
          })
          .eq('id', editingLiability.id)
        if (error) throw error
        success(t('liabilities.updated'))
      } else {
        const { error } = await supabase
          .from('liabilities')
          .insert([{
            category,
            description: description || null,
            total_amount: total,
            paid_amount: 0,
            remaining_amount: total
          }])
        if (error) throw error
        success(t('liabilities.added'))
      }
      setShowModal(false)
      await fetchData()
    } catch (err) {
      console.error('Error saving liability:', err)
      showError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handlePaymentSubmit = async (e) => {
    e.preventDefault()
    if (!paymentLiability) return
    const amount = parseFloat(paymentFormData.payment_amount)
    if (isNaN(amount) || amount <= 0) {
      showError(t('liabilities.invalidPaymentAmount'))
      return
    }
    const remaining = parseFloat(paymentLiability.remaining_amount || 0)
    if (amount > remaining) {
      showError(t('liabilities.paymentExceedsRemaining'))
      return
    }
    try {
      setSubmitting(true)
      if (paymentLiability.source === 'supplier') {
        const { error } = await supabase
          .from('payments')
          .insert([{
            transaction_id: paymentLiability.transaction_id,
            transaction_type: 'supplier',
            payment_amount: amount,
            payment_date: paymentFormData.payment_date
          }])
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('liability_payments')
          .insert([{
            liability_id: paymentLiability.id,
            payment_amount: amount,
            payment_date: paymentFormData.payment_date
          }])
        if (error) throw error
      }
      success(t('liabilities.paymentRecorded'))
      setShowPaymentModal(false)
      setPaymentLiability(null)
      await fetchData()
    } catch (err) {
      console.error('Error recording payment:', err)
      showError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget || deleteTarget.source === 'supplier') return
    try {
      setDeleting(true)
      const { error } = await supabase.from('liabilities').delete().eq('id', deleteTarget.id)
      if (error) throw error
      success(t('liabilities.deleted'))
      setDeleteTarget(null)
      await fetchData()
    } catch (err) {
      console.error('Error deleting liability:', err)
      showError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const formatNum = (n) => (Number(n) ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('liabilities.title')}</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('liabilities.subtitle')}</p>
        </div>
        <button type="button" onClick={openAdd} className="btn btn-primary flex items-center gap-2">
          <Plus size={18} />
          {t('liabilities.addLiability')}
        </button>
      </div>

      {combinedList.length === 0 ? (
        <EmptyState
          icon="payments"
          title={t('liabilities.noLiabilities')}
          description={t('liabilities.addFirstHint')}
        />
      ) : (
        <>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-yellow-100 dark:bg-yellow-900/30">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider rtl-flip">
                      {t('liabilities.category')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider rtl-flip">
                      {t('liabilities.description')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider rtl-flip">
                      {t('liabilities.value')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider rtl-flip">
                      {t('liabilities.paid')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider rtl-flip">
                      {t('liabilities.remaining')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider w-32 rtl-flip">
                      {t('common.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {paginatedList.map((row) => (
                    <tr key={row.rowId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-white rtl-flip">
                        {row.source === 'supplier'
                          ? t('liabilities.supplier')
                          : row.category === 'custom'
                            ? (row.description || t('liabilities.categoryOption_custom'))
                            : t('liabilities.categoryOption_' + (row.category || 'other'))}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 rtl-flip">
                        {row.source === 'supplier' ? row.description : (row.category === 'custom' ? '–' : (row.description || '–'))}
                      </td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums text-gray-900 dark:text-white">
                        {formatNum(row.total_amount)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums text-gray-700 dark:text-gray-300">
                        {formatNum(row.paid_amount)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums font-medium text-gray-900 dark:text-white">
                        {formatNum(row.remaining_amount)}
                      </td>
                      <td className="px-4 py-3 text-right rtl-flip">
                        <div className="flex items-center justify-end gap-1">
                          {parseFloat(row.remaining_amount || 0) > 0 && (
                            <button
                              type="button"
                              onClick={() => openPayment(row)}
                              className="p-2 rounded-lg text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
                              title={t('liabilities.recordPayment')}
                              aria-label={t('liabilities.recordPayment')}
                            >
                              <DollarSign size={18} />
                            </button>
                          )}
                          {row.source === 'liability' && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEdit(row)}
                                className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600"
                                title={t('common.edit')}
                                aria-label={t('common.edit')}
                              >
                                <Edit size={18} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(row)}
                                className="p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                                title={t('common.delete')}
                                aria-label={t('common.delete')}
                              >
                                <Trash2 size={18} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 dark:bg-gray-700/50 font-semibold">
                  <tr>
                    <td colSpan={2} className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 rtl-flip">
                      {t('liabilities.total')}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums text-gray-900 dark:text-white">
                      {formatNum(totalAmountSum)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {formatNum(paidSum)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums text-gray-900 dark:text-white">
                      {formatNum(remainingSum)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {liabilities.length > 0 && (
            <Pagination
              currentPage={effectivePage}
              totalPages={totalPages}
              onPageChange={setPage}
              pageSize={pageSize}
              onPageSizeChange={(size) => setPageSizeAndReset(Number(size))}
              totalItems={liabilities.length}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
            />
          )}
        </>
      )}

      {/* Add/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingLiability ? t('liabilities.editLiability') : t('liabilities.addLiability')}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" form="liability-form" className="btn btn-primary" disabled={submitting}>
              {submitting ? t('common.loading') : t('common.save')}
            </button>
          </div>
        }
      >
        <form id="liability-form" onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="label text-xs">{t('liabilities.category')}</label>
            <select
              className="input w-full py-2 text-sm"
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              required
            >
              {CATEGORY_KEYS.map((key) => (
                <option key={key} value={key}>
                  {t('liabilities.categoryOption_' + key)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label text-xs">{t('liabilities.description')} <span className="text-red-500">*</span></label>
            <input
              type="text"
              className="input w-full py-2 text-sm"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder={formData.category === 'custom' ? t('liabilities.customCategoryPlaceholder') : t('liabilities.descriptionPlaceholder')}
              required
            />
          </div>
          <div>
            <label className="label text-xs">{t('liabilities.value')}</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="input w-full py-2 text-sm"
              value={formData.total_amount}
              onChange={(e) => setFormData({ ...formData, total_amount: e.target.value })}
              required
            />
          </div>
        </form>
      </Modal>

      {/* Record Payment Modal */}
      <Modal
        isOpen={showPaymentModal}
        onClose={() => { setShowPaymentModal(false); setPaymentLiability(null) }}
        title={t('liabilities.recordPayment')}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => { setShowPaymentModal(false); setPaymentLiability(null) }}>
              {t('common.cancel')}
            </button>
            <button type="submit" form="payment-form" className="btn btn-primary" disabled={submitting}>
              {submitting ? t('common.loading') : t('liabilities.recordPayment')}
            </button>
          </div>
        }
      >
        {paymentLiability && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            {t('liabilities.category')}: {t('liabilities.categoryOption_' + (paymentLiability.category || 'other'))}
            {paymentLiability.description && ` – ${paymentLiability.description}`}
            <br />
            {t('liabilities.remaining')}: {formatNum(paymentLiability.remaining_amount)}
          </p>
        )}
        <form id="payment-form" onSubmit={handlePaymentSubmit} className="space-y-3">
          <div>
            <label className="label text-xs">{t('liabilities.paymentAmount')}</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="input w-full py-2 text-sm"
              value={paymentFormData.payment_amount}
              onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_amount: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label text-xs">{t('liabilities.paymentDate')}</label>
            <input
              type="date"
              className="input w-full py-2 text-sm"
              value={paymentFormData.payment_date}
              onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_date: e.target.value })}
              required
            />
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t('common.deleteConfirmTitle')}
        message={t('liabilities.deleteConfirm')}
        confirmLabel={t('common.delete')}
        isLoading={deleting}
        variant="danger"
      />
    </div>
  )
}

export default Liabilities
