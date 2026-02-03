import React, { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { useLanguage } from '../context/LanguageContext'
import { getPaginationPrefs, setPaginationPrefs } from '../utils/paginationPrefs'
import { downloadCsv } from '../utils/exportCsv'
import LoadingSpinner from './LoadingSpinner'
import EmptyState from './ui/EmptyState'
import Modal from './ui/Modal'
import ConfirmDialog from './ui/ConfirmDialog'
import Pagination from './ui/Pagination'
import { Plus, Edit, Trash2, DollarSign, Download, Printer, ChevronDown, ChevronUp, Eye } from './ui/Icons'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'

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
  const [formData, setFormData] = useState({ category: 'other', description: '', total_amount: '', due_date: '', notes: '', recurring: false })
  const [paymentFormData, setPaymentFormData] = useState({ payment_amount: '', payment_date: new Date().toISOString().split('T')[0] })
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [outstandingOnly, setOutstandingOnly] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [dueFilter, setDueFilter] = useState('all')
  const [sortBy, setSortBy] = useState('remaining_amount')
  const [sortAsc, setSortAsc] = useState(false)
  const [expandedRowId, setExpandedRowId] = useState(null)
  const [paymentsForRow, setPaymentsForRow] = useState([])
  const [loadingPayments, setLoadingPayments] = useState(false)
  const [deletePaymentTarget, setDeletePaymentTarget] = useState(null)
  const [deletingPayment, setDeletingPayment] = useState(false)

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
    const ch1 = supabase.channel('liabilities_changes').on('postgres_changes', { event: '*', schema: 'public', table: 'liabilities' }, () => fetchData()).subscribe()
    const ch2 = supabase.channel('liability_payments_changes').on('postgres_changes', { event: '*', schema: 'public', table: 'liability_payments' }, () => fetchData()).subscribe()
    const ch3 = supabase.channel('liabilities_supplier_changes').on('postgres_changes', { event: '*', schema: 'public', table: 'supplier_transactions' }, () => fetchData()).subscribe()
    return () => {
      supabase.removeChannel(ch1)
      supabase.removeChannel(ch2)
      supabase.removeChannel(ch3)
    }
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
      remaining_amount: st.remaining_amount,
      due_date: st.transaction_date || null
    }))
    return [...liabilityRows, ...supplierRows]
  }, [liabilities, supplierPayables])

  const today = useMemo(() => new Date().toISOString().split('T')[0], [])

  const filteredList = useMemo(() => {
    let list = combinedList
    if (categoryFilter !== 'all') {
      if (categoryFilter === 'supplier') list = list.filter((r) => r.source === 'supplier')
      else list = list.filter((r) => r.source === 'liability' && r.category === categoryFilter)
    }
    if (outstandingOnly) list = list.filter((r) => parseFloat(r.remaining_amount || 0) > 0)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter((r) => (r.description || '').toLowerCase().includes(q) || (r.source === 'supplier' && (r.description || '').toLowerCase().includes(q)))
    }
    if (dueFilter === 'overdue') list = list.filter((r) => r.due_date && r.due_date < today && parseFloat(r.remaining_amount || 0) > 0)
    else if (dueFilter === 'due_this_month') {
      const [y, m] = today.split('-')
      const start = `${y}-${m}-01`
      const lastDay = new Date(Number(y), Number(m), 0).getDate()
      const end = `${y}-${m}-${String(lastDay).padStart(2, '0')}`
      list = list.filter((r) => r.due_date && r.due_date >= start && r.due_date <= end)
    } else if (dueFilter === 'no_date') list = list.filter((r) => !r.due_date)
    return list
  }, [combinedList, categoryFilter, outstandingOnly, searchQuery, dueFilter, today])

  const sortedList = useMemo(() => {
    const list = [...filteredList]
    const mult = sortAsc ? 1 : -1
    list.sort((a, b) => {
      let va = a[sortBy]
      let vb = b[sortBy]
      if (sortBy === 'due_date' || sortBy === 'transaction_date') {
        va = va || '9999-99-99'
        vb = vb || '9999-99-99'
        return mult * (String(va).localeCompare(String(vb)))
      }
      if (sortBy === 'category' || sortBy === 'description') {
        va = (va || '').toString()
        vb = (vb || '').toString()
        return mult * va.localeCompare(vb)
      }
      va = parseFloat(va) || 0
      vb = parseFloat(vb) || 0
      return mult * (va - vb)
    })
    return list
  }, [filteredList, sortBy, sortAsc])

  const totalAmountSum = useMemo(() => filteredList.reduce((s, l) => s + parseFloat(l.total_amount || 0), 0), [filteredList])
  const paidSum = useMemo(() => filteredList.reduce((s, l) => s + parseFloat(l.paid_amount || 0), 0), [filteredList])
  const remainingSum = useMemo(() => filteredList.reduce((s, l) => s + parseFloat(l.remaining_amount || 0), 0), [filteredList])

  const totalsByCategory = useMemo(() => {
    const map = new Map()
    filteredList.forEach((r) => {
      const key = r.source === 'supplier' ? 'supplier' : (r.category || 'other')
      if (!map.has(key)) map.set(key, { category: key, total: 0, paid: 0, remaining: 0 })
      const o = map.get(key)
      o.total += parseFloat(r.total_amount || 0)
      o.paid += parseFloat(r.paid_amount || 0)
      o.remaining += parseFloat(r.remaining_amount || 0)
    })
    return Array.from(map.values())
  }, [filteredList])

  const chartData = useMemo(() => totalsByCategory.map((c) => ({ name: c.category === 'supplier' ? t('liabilities.supplier') : t('liabilities.categoryOption_' + (c.category || 'other')), value: c.remaining })).filter((d) => d.value > 0), [totalsByCategory, t])

  const totalPages = Math.max(1, Math.ceil(sortedList.length / pageSize))
  const effectivePage = Math.min(currentPage, totalPages)
  const paginatedList = useMemo(() => {
    const start = (effectivePage - 1) * pageSize
    return sortedList.slice(start, start + pageSize)
  }, [sortedList, effectivePage, pageSize])

  const toggleSort = (col) => {
    setSortBy(col)
    setSortAsc((prev) => (sortBy === col ? !prev : true))
  }

  const openAdd = () => {
    setEditingLiability(null)
    setFormData({ category: 'other', description: '', total_amount: '', due_date: '', notes: '', recurring: false })
    setShowModal(true)
  }

  const openEdit = (row) => {
    if (row.source === 'supplier') return
    setEditingLiability(row)
    setFormData({
      category: row.category || 'other',
      description: row.description || '',
      total_amount: String(row.total_amount ?? ''),
      due_date: row.due_date || '',
      notes: row.notes || '',
      recurring: !!row.recurring
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
      const payload = {
        category,
        description: description || null,
        total_amount: total,
        due_date: formData.due_date || null,
        notes: formData.notes?.trim() || null,
        recurring: !!formData.recurring
      }
      if (editingLiability) {
        const paid = parseFloat(editingLiability.paid_amount || 0)
        const remaining = Math.max(0, total - paid)
        const { error } = await supabase
          .from('liabilities')
          .update({ ...payload, paid_amount: paid, remaining_amount: remaining })
          .eq('id', editingLiability.id)
        if (error) throw error
        success(t('liabilities.updated'))
      } else {
        const { error } = await supabase
          .from('liabilities')
          .insert([{ ...payload, paid_amount: 0, remaining_amount: total }])
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

  const fetchPaymentsForRow = async (row) => {
    setExpandedRowId(row.rowId === expandedRowId ? null : row.rowId)
    if (row.rowId === expandedRowId) {
      setPaymentsForRow([])
      return
    }
    setLoadingPayments(true)
    try {
      if (row.source === 'supplier') {
        const { data, error } = await supabase.from('payments').select('*').eq('transaction_type', 'supplier').eq('transaction_id', row.transaction_id).order('payment_date', { ascending: false })
        if (error) throw error
        setPaymentsForRow(data || [])
      } else {
        const { data, error } = await supabase.from('liability_payments').select('*').eq('liability_id', row.id).order('payment_date', { ascending: false })
        if (error) throw error
        setPaymentsForRow(data || [])
      }
    } catch (err) {
      showError(err.message)
      setPaymentsForRow([])
    } finally {
      setLoadingPayments(false)
    }
  }

  const handleDeletePayment = async () => {
    if (!deletePaymentTarget) return
    const { payment, row } = deletePaymentTarget
    try {
      setDeletingPayment(true)
      if (row.source === 'supplier') {
        const { error } = await supabase.from('payments').delete().eq('payment_id', payment.payment_id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('liability_payments').delete().eq('id', payment.id)
        if (error) throw error
      }
      success(t('liabilities.paymentDeleted'))
      setDeletePaymentTarget(null)
      setPaymentsForRow((prev) => prev.filter((p) => (row.source === 'supplier' ? p.payment_id !== payment.payment_id : p.id !== payment.id)))
      await fetchData()
    } catch (err) {
      showError(err.message)
    } finally {
      setDeletingPayment(false)
    }
  }

  const handleExportCsv = () => {
    const rows = sortedList.map((r) => ({
      [t('liabilities.category')]: r.source === 'supplier' ? t('liabilities.supplier') : (r.category === 'custom' ? r.description : t('liabilities.categoryOption_' + (r.category || 'other'))),
      [t('liabilities.description')]: r.description || '–',
      Type: r.source === 'supplier' ? 'Supplier' : 'Other',
      [t('liabilities.value')]: formatNum(r.total_amount),
      [t('liabilities.paid')]: formatNum(r.paid_amount),
      [t('liabilities.remaining')]: formatNum(r.remaining_amount),
      [t('liabilities.dueDate')]: r.due_date || '–'
    }))
    downloadCsv('liabilities.csv', rows)
    success(t('common.exportCsv'))
  }

  const handlePrint = () => {
    window.print()
  }

  const formatNum = (n) => (Number(n) ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('liabilities.title')}</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('liabilities.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={handleExportCsv} disabled={sortedList.length === 0} className="btn btn-secondary flex items-center gap-2">
            <Download size={18} />
            {t('common.exportCsv')}
          </button>
          <button type="button" onClick={handlePrint} disabled={sortedList.length === 0} className="btn btn-secondary flex items-center gap-2">
            <Printer size={18} />
            {t('common.print')}
          </button>
          <button type="button" onClick={openAdd} className="btn btn-primary flex items-center gap-2">
            <Plus size={18} />
            {t('liabilities.addLiability')}
          </button>
        </div>
      </div>

      {/* Filters */}
      {combinedList.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <select
            className="input py-2 text-sm w-40"
            value={categoryFilter}
            onChange={(e) => { setCategoryFilter(e.target.value); setPage(1) }}
          >
            <option value="all">{t('liabilities.filterAllCategories')}</option>
            <option value="supplier">{t('liabilities.supplier')}</option>
            {CATEGORY_KEYS.filter((k) => k !== 'custom').map((key) => (
              <option key={key} value={key}>{t('liabilities.categoryOption_' + key)}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={outstandingOnly} onChange={(e) => { setOutstandingOnly(e.target.checked); setPage(1) }} className="rounded" />
            {t('liabilities.outstandingOnly')}
          </label>
          <select
            className="input py-2 text-sm w-40"
            value={dueFilter}
            onChange={(e) => { setDueFilter(e.target.value); setPage(1) }}
          >
            <option value="all">{t('liabilities.dueAll')}</option>
            <option value="overdue">{t('liabilities.dueOverdue')}</option>
            <option value="due_this_month">{t('liabilities.dueThisMonth')}</option>
            <option value="no_date">{t('liabilities.dueNoDate')}</option>
          </select>
          <input
            type="search"
            className="input py-2 text-sm w-48"
            placeholder={t('common.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1) }}
          />
        </div>
      )}

      {sortedList.length === 0 ? (
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
                      <button type="button" onClick={() => toggleSort('category')} className="flex items-center gap-1 hover:underline">
                        {t('liabilities.category')} {sortBy === 'category' && (sortAsc ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider rtl-flip">
                      <button type="button" onClick={() => toggleSort('description')} className="flex items-center gap-1 hover:underline">
                        {t('liabilities.description')} {sortBy === 'description' && (sortAsc ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider rtl-flip">
                      <button type="button" onClick={() => toggleSort('total_amount')} className="flex items-center gap-1 hover:underline ml-auto">
                        {t('liabilities.value')} {sortBy === 'total_amount' && (sortAsc ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider rtl-flip">
                      <button type="button" onClick={() => toggleSort('paid_amount')} className="flex items-center gap-1 hover:underline ml-auto">
                        {t('liabilities.paid')} {sortBy === 'paid_amount' && (sortAsc ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider rtl-flip">
                      <button type="button" onClick={() => toggleSort('remaining_amount')} className="flex items-center gap-1 hover:underline ml-auto">
                        {t('liabilities.remaining')} {sortBy === 'remaining_amount' && (sortAsc ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider rtl-flip">
                      <button type="button" onClick={() => toggleSort('due_date')} className="flex items-center gap-1 hover:underline ml-auto">
                        {t('liabilities.dueDate')} {sortBy === 'due_date' && (sortAsc ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider w-36 rtl-flip print:hidden">
                      {t('common.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {paginatedList.map((row) => {
                    const isOverdue = row.due_date && row.due_date < today && parseFloat(row.remaining_amount || 0) > 0
                    return (
                      <React.Fragment key={row.rowId}>
                        <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="px-4 py-3 text-sm text-gray-900 dark:text-white rtl-flip">
                            {row.source === 'supplier'
                              ? t('liabilities.supplier')
                              : row.category === 'custom'
                                ? (row.description || t('liabilities.categoryOption_custom'))
                                : t('liabilities.categoryOption_' + (row.category || 'other'))}
                            {row.source === 'liability' && row.recurring && (
                              <span className="ml-1 text-xs text-blue-600 dark:text-blue-400" title={t('liabilities.recurring')}>↻</span>
                            )}
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
                          <td className="px-4 py-3 text-sm text-right rtl-flip">
                            {row.due_date ? (
                              <span className={isOverdue ? 'text-red-600 dark:text-red-400 font-medium' : ''}>
                                {row.due_date}
                                {isOverdue && <span className="ml-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded">{t('liabilities.overdue')}</span>}
                              </span>
                            ) : '–'}
                          </td>
                          <td className="px-4 py-3 text-right rtl-flip print:hidden">
                            <div className="flex items-center justify-end gap-1">
                              {parseFloat(row.remaining_amount || 0) > 0 && (
                                <button type="button" onClick={() => openPayment(row)} className="p-2 rounded-lg text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20" title={t('liabilities.recordPayment')} aria-label={t('liabilities.recordPayment')}>
                                  <DollarSign size={18} />
                                </button>
                              )}
                              <button type="button" onClick={() => fetchPaymentsForRow(row)} className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600" title={t('liabilities.viewPayments')} aria-label={t('liabilities.viewPayments')}>
                                <Eye size={18} />
                              </button>
                              {row.source === 'liability' && (
                                <>
                                  <button type="button" onClick={() => openEdit(row)} className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600" title={t('common.edit')} aria-label={t('common.edit')}>
                                    <Edit size={18} />
                                  </button>
                                  <button type="button" onClick={() => setDeleteTarget(row)} className="p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" title={t('common.delete')} aria-label={t('common.delete')}>
                                    <Trash2 size={18} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expandedRowId === row.rowId && (
                          <tr className="bg-gray-50 dark:bg-gray-700/30">
                            <td colSpan={8} className="px-4 py-3 text-sm rtl-flip">
                              <div className="font-medium mb-2">{t('liabilities.paymentHistory')}</div>
                              {loadingPayments ? (
                                <span className="text-gray-500">{t('common.loading')}</span>
                              ) : paymentsForRow.length === 0 ? (
                                <span className="text-gray-500">{t('liabilities.noPayments')}</span>
                              ) : (
                                <ul className="space-y-1">
                                  {paymentsForRow.map((p) => (
                                    <li key={row.source === 'supplier' ? p.payment_id : p.id} className="flex items-center justify-between gap-2 py-1 border-b border-gray-200 dark:border-gray-600 last:border-0">
                                      <span>{p.payment_date} – {formatNum(p.payment_amount)}</span>
                                      {row.source === 'liability' && (
                                        <button type="button" onClick={() => setDeletePaymentTarget({ payment: p, row })} className="text-red-600 hover:underline text-xs">{t('common.delete')}</button>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
                <tfoot className="bg-gray-50 dark:bg-gray-700/50 font-semibold">
                  <tr>
                    <td colSpan={2} className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 rtl-flip">
                      {t('liabilities.total')}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums text-gray-900 dark:text-white">{formatNum(totalAmountSum)}</td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums text-gray-700 dark:text-gray-300">{formatNum(paidSum)}</td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums text-gray-900 dark:text-white">{formatNum(remainingSum)}</td>
                    <td colSpan={2} />
                  </tr>
                  {totalsByCategory.length > 1 && totalsByCategory.map((c) => (
                    <tr key={c.category} className="text-gray-600 dark:text-gray-400 text-xs">
                      <td colSpan={2} className="px-4 py-1 rtl-flip">
                        {c.category === 'supplier' ? t('liabilities.supplier') : t('liabilities.categoryOption_' + (c.category || 'other'))}
                      </td>
                      <td className="px-4 py-1 text-right tabular-nums">{formatNum(c.total)}</td>
                      <td className="px-4 py-1 text-right tabular-nums">{formatNum(c.paid)}</td>
                      <td className="px-4 py-1 text-right tabular-nums">{formatNum(c.remaining)}</td>
                      <td colSpan={2} />
                    </tr>
                  ))}
                </tfoot>
              </table>
            </div>
          </div>

          {chartData.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 print:hidden">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">{t('liabilities.remainingByCategory')}</h2>
              <div className="h-64" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {chartData.map((_, i) => (
                        <Cell key={i} fill={['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#6366f1'][i % 6]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => formatNum(v)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {sortedList.length > 0 && (
            <Pagination
              currentPage={effectivePage}
              totalPages={totalPages}
              onPageChange={setPage}
              pageSize={pageSize}
              onPageSizeChange={(size) => setPageSizeAndReset(Number(size))}
              totalItems={sortedList.length}
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
          <div>
            <label className="label text-xs">{t('liabilities.dueDate')}</label>
            <input
              type="date"
              className="input w-full py-2 text-sm"
              value={formData.due_date}
              onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
            />
          </div>
          <div>
            <label className="label text-xs">{t('liabilities.notes')}</label>
            <textarea
              className="input w-full py-2 text-sm min-h-[60px]"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder={t('liabilities.notesPlaceholder')}
              rows={2}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={formData.recurring} onChange={(e) => setFormData({ ...formData, recurring: e.target.checked })} className="rounded" />
            {t('liabilities.recurring')}
          </label>
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

      <ConfirmDialog
        isOpen={!!deletePaymentTarget}
        onClose={() => setDeletePaymentTarget(null)}
        onConfirm={handleDeletePayment}
        title={t('common.deleteConfirmTitle')}
        message={t('liabilities.deletePaymentConfirm')}
        confirmLabel={t('common.delete')}
        isLoading={deletingPayment}
        variant="danger"
      />
    </div>
  )
}

export default Liabilities
