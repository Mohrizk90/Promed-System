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
import Dropdown from './ui/Dropdown'
import { Plus, Download, Printer, ChevronDown, ChevronUp, Wallet, Edit as EditIcon, Trash2 } from './ui/Icons'
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
  const [formData, setFormData] = useState({ category: '', description: '', total_amount: '', due_date: '', recurring: false, notes: '' })
  const [paymentFormData, setPaymentFormData] = useState({ payment_amount: '', payment_date: new Date().toISOString().split('T')[0] })
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [outstandingOnly, setOutstandingOnly] = useState(false)
  const [recurringOnly, setRecurringOnly] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [dueFilter, setDueFilter] = useState('all')
  const [dueDateFrom, setDueDateFrom] = useState('')
  const [dueDateTo, setDueDateTo] = useState('')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [sortBy, setSortBy] = useState('remaining_amount')
  const [sortAsc, setSortAsc] = useState(false)
  const [expandedRowId, setExpandedRowId] = useState(null)
  const [paymentsForRow, setPaymentsForRow] = useState([])
  const [loadingPayments, setLoadingPayments] = useState(false)
  const [deletePaymentTarget, setDeletePaymentTarget] = useState(null)
  const [deletingPayment, setDeletingPayment] = useState(false)
  const [formErrors, setFormErrors] = useState({})
  const [showPaidColumn, setShowPaidColumn] = useState(true)

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
    if (recurringOnly) list = list.filter((r) => r.source === 'liability' && !!r.recurring)
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
    } else if (dueFilter === 'due_next_7_days') {
      const endDate = new Date(today)
      endDate.setDate(endDate.getDate() + 7)
      const endStr = endDate.toISOString().split('T')[0]
      list = list.filter((r) => r.due_date && r.due_date >= today && r.due_date <= endStr && parseFloat(r.remaining_amount || 0) > 0)
    } else if (dueFilter === 'no_date') list = list.filter((r) => !r.due_date)
    if (dueDateFrom) list = list.filter((r) => r.due_date && r.due_date >= dueDateFrom)
    if (dueDateTo) list = list.filter((r) => r.due_date && r.due_date <= dueDateTo)
    if (amountMin !== '') {
      const min = parseFloat(amountMin)
      if (!isNaN(min)) list = list.filter((r) => parseFloat(r.remaining_amount || 0) >= min)
    }
    if (amountMax !== '') {
      const max = parseFloat(amountMax)
      if (!isNaN(max)) list = list.filter((r) => parseFloat(r.remaining_amount || 0) <= max)
    }
    return list
  }, [combinedList, categoryFilter, outstandingOnly, recurringOnly, searchQuery, dueFilter, today, dueDateFrom, dueDateTo, amountMin, amountMax])

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

  const overdueCount = useMemo(() => combinedList.filter((r) => r.due_date && r.due_date < today && parseFloat(r.remaining_amount || 0) > 0).length, [combinedList, today])

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
    setFormData({ category: '', description: '', total_amount: '', due_date: '', recurring: false, notes: '' })
    setFormErrors({})
    setShowModal(true)
  }

  const openEdit = (row) => {
    if (row.source === 'supplier') return
    setEditingLiability(row)
    setFormData({
      category: row.category || '',
      description: row.description || '',
      total_amount: String(row.total_amount ?? ''),
      due_date: row.due_date || '',
      recurring: !!row.recurring,
      notes: row.notes || ''
    })
    setFormErrors({})
    setShowModal(true)
  }

  const openPayment = (row) => {
    setPaymentLiability(row)
    setPaymentFormData({ payment_amount: '', payment_date: new Date().toISOString().split('T')[0] })
    setFormErrors({})
    setShowPaymentModal(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormErrors((prev) => ({ ...prev, total_amount: undefined }))
    const description = (formData.description || '').trim() || null
    const total = parseFloat(formData.total_amount)
    if (isNaN(total) || total < 0) {
      setFormErrors((prev) => ({ ...prev, total_amount: t('liabilities.invalidAmount') }))
      return
    }
    const categoryInput = (formData.category || '').trim()
    let category = categoryInput || 'other'
    for (const key of CATEGORY_KEYS) {
      if (key !== 'custom' && t('liabilities.categoryOption_' + key) === categoryInput) {
        category = key
        break
      }
    }
    try {
      setSubmitting(true)
      const notes = (formData.notes || '').trim() || null
      const payload = {
        category,
        description,
        total_amount: total,
        due_date: formData.due_date || null,
        recurring: !!formData.recurring,
        notes
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
    setFormErrors((prev) => ({ ...prev, payment_amount: undefined }))
    if (!paymentLiability) return
    const amount = parseFloat(paymentFormData.payment_amount)
    if (isNaN(amount) || amount <= 0) {
      setFormErrors((prev) => ({ ...prev, payment_amount: t('liabilities.invalidPaymentAmount') }))
      return
    }
    const remaining = parseFloat(paymentLiability.remaining_amount || 0)
    if (amount > remaining) {
      setFormErrors((prev) => ({ ...prev, payment_amount: t('liabilities.paymentExceedsRemaining') }))
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
    <div className="flex flex-col space-y-2 pb-4">
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 print:hidden">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">{t('liabilities.title')}</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('liabilities.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={handlePrint} disabled={sortedList.length === 0} className="btn btn-secondary flex items-center gap-2 py-1.5 px-3 text-sm">
              <Printer size={18} />
              {t('common.print')}
            </button>
            <button type="button" onClick={handleExportCsv} disabled={sortedList.length === 0} className="btn btn-secondary flex items-center gap-2 py-1.5 px-3 text-sm">
              <Download size={18} />
              {t('common.exportCsv')}
            </button>
            <button type="button" onClick={openAdd} className="bg-amber-600 hover:bg-amber-700 text-white font-semibold py-2 px-4 rounded text-sm flex items-center gap-2">
              <Plus size={18} />
              {t('liabilities.addLiability')}
            </button>
          </div>
        </div>

        {/* Summary cards - same style as Client/Supplier */}
        {filteredList.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 print:hidden">
            <div className="bg-amber-600 text-white p-2.5 rounded shadow">
              <p className="text-xs font-medium">{t('liabilities.value')}</p>
              <p className="text-lg font-bold">${formatNum(totalAmountSum)}</p>
            </div>
            <div className="bg-green-600 text-white p-2.5 rounded shadow">
              <p className="text-xs font-medium">{t('liabilities.paid')}</p>
              <p className="text-lg font-bold">${formatNum(paidSum)}</p>
            </div>
            <div className="bg-red-600 text-white p-2.5 rounded shadow">
              <p className="text-xs font-medium">{t('liabilities.remaining')}</p>
              <p className="text-lg font-bold">${formatNum(remainingSum)}</p>
            </div>
          </div>
        )}

      {/* Category quick-filter buttons (Salaries, Taxes, etc.) */}
      {combinedList.length > 0 && (
        <div className="print:hidden mb-3">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t('liabilities.category')} – {t('common.quickFilter')}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { setCategoryFilter('all'); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${categoryFilter === 'all' ? 'bg-gray-700 text-white dark:bg-gray-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}`}
            >
              {t('liabilities.filterAllCategories')}
            </button>
            <button
              type="button"
              onClick={() => { setCategoryFilter('supplier'); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${categoryFilter === 'supplier' ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:hover:bg-purple-900/60'}`}
            >
              {t('liabilities.supplier')}
            </button>
            {CATEGORY_KEYS.filter((k) => k !== 'custom').map((key) => {
              const isActive = categoryFilter === key
              const styles = {
                salaries: { active: 'bg-amber-600 text-white', inactive: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900/60' },
                taxes: { active: 'bg-red-600 text-white', inactive: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200 hover:bg-red-200 dark:hover:bg-red-900/60' },
                tax_accountant: { active: 'bg-red-500 text-white', inactive: 'bg-red-100/80 text-red-700 dark:bg-red-900/30 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50' },
                invoices_accountant: { active: 'bg-blue-600 text-white', inactive: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-900/60' },
                municipal: { active: 'bg-teal-600 text-white', inactive: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200 hover:bg-teal-200 dark:hover:bg-teal-900/60' },
                lawyer: { active: 'bg-slate-600 text-white', inactive: 'bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600/50' },
                insurance: { active: 'bg-green-600 text-white', inactive: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200 hover:bg-green-200 dark:hover:bg-green-900/60' },
                liabilities: { active: 'bg-orange-600 text-white', inactive: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200 hover:bg-orange-200 dark:hover:bg-orange-900/60' },
                other: { active: 'bg-gray-600 text-white dark:bg-gray-500', inactive: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600' },
              }
              const s = styles[key] || styles.other
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setCategoryFilter(key); setPage(1) }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isActive ? s.active : s.inactive}`}
                >
                  {t('liabilities.categoryOption_' + key)}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Filters */}
        {combinedList.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-2 print:hidden">
            <div className="flex flex-wrap items-center gap-2">
              <select className="input py-1.5 text-sm w-36" value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1) }}>
                <option value="all">{t('liabilities.filterAllCategories')}</option>
                <option value="supplier">{t('liabilities.supplier')}</option>
                {CATEGORY_KEYS.filter((k) => k !== 'custom').map((key) => (
                  <option key={key} value={key}>{t('liabilities.categoryOption_' + key)}</option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={outstandingOnly} onChange={(e) => { setOutstandingOnly(e.target.checked); setPage(1) }} className="rounded" />
                {t('liabilities.outstandingOnly')}
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={recurringOnly} onChange={(e) => { setRecurringOnly(e.target.checked); setPage(1) }} className="rounded" />
                {t('liabilities.recurringOnly')}
              </label>
              <select className="input py-1.5 text-sm w-36" value={dueFilter} onChange={(e) => { setDueFilter(e.target.value); setPage(1) }}>
                <option value="all">{t('liabilities.dueAll')}</option>
                <option value="overdue">{t('liabilities.dueOverdue')}{overdueCount > 0 ? ` (${overdueCount})` : ''}</option>
                <option value="due_next_7_days">{t('liabilities.dueNext7Days')}</option>
                <option value="due_this_month">{t('liabilities.dueThisMonth')}</option>
                <option value="no_date">{t('liabilities.dueNoDate')}</option>
              </select>
              <input type="search" className="input py-1.5 text-sm w-40" placeholder={t('common.searchPlaceholder')} value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setPage(1) }} />
              <span className="text-xs text-gray-500 dark:text-gray-400">{t('liabilities.dueDateRange')}:</span>
              <input type="date" className="input py-1.5 text-sm w-32" value={dueDateFrom} onChange={(e) => { setDueDateFrom(e.target.value); setPage(1) }} title={t('liabilities.dueFrom')} />
              <span className="text-gray-400">–</span>
              <input type="date" className="input py-1.5 text-sm w-32" value={dueDateTo} onChange={(e) => { setDueDateTo(e.target.value); setPage(1) }} title={t('liabilities.dueTo')} />
              <span className="text-xs text-gray-500 dark:text-gray-400">{t('liabilities.remainingRange')}:</span>
              <input type="number" step="0.01" min="0" className="input py-1.5 text-sm w-24" placeholder={t('liabilities.min')} value={amountMin} aria-label={t('liabilities.min')} onChange={(e) => { setAmountMin(e.target.value); setPage(1) }} />
              <span className="text-gray-400">–</span>
              <input type="number" step="0.01" min="0" className="input py-1.5 text-sm w-24" placeholder={t('liabilities.maxAmount')} value={amountMax} aria-label={t('liabilities.maxAmount')} onChange={(e) => { setAmountMax(e.target.value); setPage(1) }} />
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={showPaidColumn} onChange={(e) => setShowPaidColumn(e.target.checked)} className="rounded" />
                {t('liabilities.showPaidColumn')}
              </label>
            </div>
          </div>
        )}
      </div>

      {overdueCount > 0 && (
        <div className="print:hidden rounded-lg bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-800 dark:text-red-200 font-medium">
          {overdueCount} {t('liabilities.overdue')}
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
          <div className="bg-white dark:bg-gray-800 shadow rounded overflow-x-auto overflow-y-visible mt-2">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-xs">
              <thead className="bg-gray-100 dark:bg-gray-700/50 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-2 py-1 text-left font-semibold text-gray-700 dark:text-gray-200 uppercase w-28 whitespace-nowrap rtl-flip">
                    <button type="button" onClick={() => toggleSort('category')} className="flex items-center gap-0.5 hover:underline">
                      {t('liabilities.category')} {sortBy === 'category' && (sortAsc ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                    </button>
                  </th>
                  <th className="px-2 py-1 text-left font-semibold text-gray-700 dark:text-gray-200 uppercase min-w-[100px] rtl-flip">
                    <button type="button" onClick={() => toggleSort('description')} className="flex items-center gap-0.5 hover:underline">
                      {t('liabilities.description')} {sortBy === 'description' && (sortAsc ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                    </button>
                  </th>
                  <th className="px-2 py-1 text-right font-semibold text-gray-700 dark:text-gray-200 uppercase w-20 whitespace-nowrap rtl-flip">
                    <button type="button" onClick={() => toggleSort('total_amount')} className="hover:underline ml-auto">{t('liabilities.value')} {sortBy === 'total_amount' && (sortAsc ? '↑' : '↓')}</button>
                  </th>
                  {showPaidColumn && (
                    <th className="px-2 py-1 text-right font-semibold text-gray-700 dark:text-gray-200 uppercase w-20 whitespace-nowrap rtl-flip">
                      <button type="button" onClick={() => toggleSort('paid_amount')} className="hover:underline ml-auto">{t('liabilities.paid')} {sortBy === 'paid_amount' && (sortAsc ? '↑' : '↓')}</button>
                    </th>
                  )}
                  <th className="px-2 py-1 text-right font-semibold text-gray-700 dark:text-gray-200 uppercase w-20 whitespace-nowrap rtl-flip">
                    <button type="button" onClick={() => toggleSort('remaining_amount')} className="hover:underline ml-auto">{t('liabilities.remaining')} {sortBy === 'remaining_amount' && (sortAsc ? '↑' : '↓')}</button>
                  </th>
                  <th className="px-2 py-1 text-right font-semibold text-gray-700 dark:text-gray-200 uppercase w-24 whitespace-nowrap rtl-flip">
                    <button type="button" onClick={() => toggleSort('due_date')} className="hover:underline ml-auto">{t('liabilities.dueDate')} {sortBy === 'due_date' && (sortAsc ? '↑' : '↓')}</button>
                  </th>
                  <th className="px-2 py-1 text-left font-semibold text-gray-700 dark:text-gray-200 uppercase w-28 whitespace-nowrap rtl-flip print:hidden">
                    {t('common.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {paginatedList.map((row) => {
                  const isOverdue = row.due_date && row.due_date < today && parseFloat(row.remaining_amount || 0) > 0
                  const isExpanded = expandedRowId === row.rowId
                  return (
                    <React.Fragment key={row.rowId}>
                      <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="px-2 py-1 text-gray-900 dark:text-white rtl-flip whitespace-nowrap">
                          <span className={`inline px-1 py-0.5 rounded text-[10px] font-medium ${row.source === 'supplier' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200'}`}>
                            {row.source === 'supplier' ? t('liabilities.supplier') : (CATEGORY_KEYS.includes(row.category) ? t('liabilities.categoryOption_' + (row.category || 'other')) : (row.category || t('liabilities.categoryOption_other')))}
                          </span>
                          {row.source === 'liability' && row.recurring && <span className="ml-0.5 text-blue-600 dark:text-blue-400" title={t('liabilities.recurring')}>↻</span>}
                        </td>
                        <td className="px-2 py-1 text-gray-700 dark:text-gray-300 rtl-flip max-w-[140px] truncate" title={row.source === 'supplier' ? row.description : (row.description || '–') + (row.notes ? '\n\nNotes: ' + row.notes : '')}>
                          {row.source === 'supplier' ? row.description : (row.description || '–')}
                          {row.source === 'liability' && row.notes && <span className="ml-0.5 text-gray-400 dark:text-gray-500" title={row.notes}>📝</span>}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums font-medium text-gray-900 dark:text-white whitespace-nowrap">${formatNum(row.total_amount)}</td>
                        {showPaidColumn && <td className="px-2 py-1 text-right tabular-nums text-green-700 dark:text-green-400 whitespace-nowrap">${formatNum(row.paid_amount)}</td>}
                        <td className="px-2 py-1 text-right tabular-nums font-medium text-red-700 dark:text-red-400 whitespace-nowrap">${formatNum(row.remaining_amount)}</td>
                        <td className="px-2 py-1 text-right rtl-flip whitespace-nowrap">
                          {row.due_date ? (
                            <span className={isOverdue ? 'text-red-600 dark:text-red-400 font-medium' : ''}>
                              {row.due_date}
                              {isOverdue && <span className="ml-0.5 text-[10px] bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-1 py-0.5 rounded">{t('liabilities.overdue')}</span>}
                            </span>
                          ) : '–'}
                        </td>
                        <td className="px-2 py-1 rtl-flip print:hidden whitespace-nowrap">
                          <Dropdown
                            align="right"
                            items={[
                              { label: t('paymentsBreakdown.payments'), icon: Wallet, onClick: () => fetchPaymentsForRow(row) },
                              ...(row.source === 'liability' ? [
                                { divider: true },
                                { label: t('common.edit'), icon: EditIcon, onClick: () => openEdit(row) },
                                { label: t('common.delete'), icon: Trash2, danger: true, onClick: () => setDeleteTarget(row) }
                              ] : [])
                            ]}
                          />
                        </td>
                      </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={showPaidColumn ? 7 : 6} className="px-2 py-1 align-top rtl-flip">
                              <div className="payment-detail-row py-1.5 pl-2 pr-1 border-l-4 border-amber-200 bg-amber-50/50 dark:bg-amber-900/10 dark:border-amber-700 rounded-r text-xs">
                                <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-gray-800 dark:text-white">{t('paymentsBreakdown.payments')}</span>
                                    <span className="text-green-700 dark:text-green-400">{t('dashboard.paid')}: ${formatNum(row.paid_amount)}</span>
                                    <span className="text-red-600 dark:text-red-400">{t('dashboard.remaining')}: ${formatNum(row.remaining_amount)}</span>
                                  </div>
                                  {parseFloat(row.remaining_amount || 0) > 0 && (
                                    <button type="button" onClick={() => openPayment(row)} className="px-1.5 py-0.5 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded text-[10px]">
                                      + {t('paymentsBreakdown.addPayment')}
                                    </button>
                                  )}
                                </div>
                                {loadingPayments ? (
                                  <p className="text-gray-500 py-1">{t('common.loading')}</p>
                                ) : paymentsForRow.length === 0 ? (
                                  <p className="text-gray-500 py-1 text-center border border-dashed border-gray-300 dark:border-gray-600 rounded">{t('liabilities.noPayments')}</p>
                                ) : (
                                  <div className="space-y-0.5">
                                    {paymentsForRow.map((p) => (
                                      <div key={row.source === 'supplier' ? p.payment_id : p.id} className="flex items-center justify-between py-1 px-1.5 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-600">
                                        <span>{p.payment_date} – ${formatNum(p.payment_amount)}</span>
                                        <button type="button" onClick={() => setDeletePaymentTarget({ payment: p, row })} className="text-red-600 hover:underline text-[10px]">{t('common.delete')}</button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
                <tfoot className="bg-gray-100 dark:bg-gray-700/70 font-semibold border-t-2 border-gray-200 dark:border-gray-600 text-xs">
                <tr>
                  <td colSpan={2} className="px-2 py-1 text-gray-800 dark:text-gray-200 rtl-flip">{t('liabilities.total')}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-gray-900 dark:text-white whitespace-nowrap">${formatNum(totalAmountSum)}</td>
                  {showPaidColumn && <td className="px-2 py-1 text-right tabular-nums text-green-700 dark:text-green-400 whitespace-nowrap">${formatNum(paidSum)}</td>}
                  <td className="px-2 py-1 text-right tabular-nums text-red-700 dark:text-red-400 whitespace-nowrap">${formatNum(remainingSum)}</td>
                  <td colSpan={2} />
                </tr>
                {totalsByCategory.length > 1 && totalsByCategory.map((c) => (
                  <tr key={c.category} className="text-gray-600 dark:text-gray-400 border-t border-gray-200 dark:border-gray-600">
                    <td colSpan={2} className="px-2 py-0.5 rtl-flip">{c.category === 'supplier' ? t('liabilities.supplier') : (CATEGORY_KEYS.includes(c.category) ? t('liabilities.categoryOption_' + (c.category || 'other')) : (c.category || '–'))}</td>
                    <td className="px-2 py-0.5 text-right tabular-nums whitespace-nowrap">${formatNum(c.total)}</td>
                    {showPaidColumn && <td className="px-2 py-0.5 text-right tabular-nums whitespace-nowrap">${formatNum(c.paid)}</td>}
                    <td className="px-2 py-0.5 text-right tabular-nums whitespace-nowrap">${formatNum(c.remaining)}</td>
                    <td colSpan={2} />
                  </tr>
                ))}
              </tfoot>
            </table>
          </div>
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

          {chartData.length > 0 && (
            <div className="flex-shrink-0 bg-white dark:bg-gray-800 rounded-lg shadow p-3 print:hidden mt-2">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">{t('liabilities.remainingByCategory')}</h2>
              <div className="h-48" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {chartData.map((_, i) => (
                        <Cell key={i} fill={['#d97706', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#6366f1'][i % 6]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => '$' + formatNum(v)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
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
            <label className="label text-xs">{t('liabilities.category')} <span className="text-red-500">*</span></label>
            <input
              type="text"
              className="input w-full py-2 text-sm"
              list="liability-category-suggestions"
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              placeholder={t('liabilities.categoryPlaceholder')}
              required
            />
            <datalist id="liability-category-suggestions">
              {CATEGORY_KEYS.filter((k) => k !== 'custom').map((key) => (
                <option key={key} value={t('liabilities.categoryOption_' + key)} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="label text-xs">{t('liabilities.description')}</label>
            <input
              type="text"
              className="input w-full py-2 text-sm"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder={t('liabilities.descriptionPlaceholder')}
            />
          </div>
          <div>
            <label className="label text-xs" htmlFor="liability-total_amount">{t('liabilities.value')} <span className="text-red-500" aria-hidden="true">*</span></label>
            <input
              id="liability-total_amount"
              type="number"
              step="0.01"
              min="0"
              className={`input w-full py-2 text-sm ${formErrors.total_amount ? 'border-red-500 dark:border-red-400' : ''}`}
              value={formData.total_amount}
              onChange={(e) => { setFormData({ ...formData, total_amount: e.target.value }); setFormErrors((p) => ({ ...p, total_amount: undefined })) }}
              required
              aria-required="true"
              aria-invalid={!!formErrors.total_amount}
              aria-describedby={formErrors.total_amount ? 'liability-total_amount-error' : undefined}
            />
            {formErrors.total_amount && <p id="liability-total_amount-error" className="text-xs text-red-600 dark:text-red-400 mt-0.5" role="alert">{formErrors.total_amount}</p>}
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
              className="input w-full py-2 text-sm min-h-[60px] resize-y"
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
          <div className="bg-gray-100 dark:bg-gray-700/50 rounded-lg p-3 mb-4 border border-gray-200 dark:border-gray-600">
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {paymentLiability.source === 'supplier' ? t('liabilities.supplier') : (CATEGORY_KEYS.includes(paymentLiability.category) ? t('liabilities.categoryOption_' + (paymentLiability.category || 'other')) : (paymentLiability.category || '–'))}
              {paymentLiability.description && ` – ${paymentLiability.description}`}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {t('liabilities.remaining')}: <strong className="text-red-600 dark:text-red-400">{formatNum(paymentLiability.remaining_amount)}</strong>
            </p>
          </div>
        )}
        <form id="payment-form" onSubmit={handlePaymentSubmit} className="space-y-3">
          <div>
            <label className="label text-xs" htmlFor="payment-amount">{t('liabilities.paymentAmount')} <span className="text-red-500" aria-hidden="true">*</span></label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="payment-amount"
                type="number"
                step="0.01"
                min="0.01"
                className={`input flex-1 min-w-0 py-2 text-sm ${formErrors.payment_amount ? 'border-red-500 dark:border-red-400' : ''}`}
                value={paymentFormData.payment_amount}
                onChange={(e) => { setPaymentFormData({ ...paymentFormData, payment_amount: e.target.value }); setFormErrors((p) => ({ ...p, payment_amount: undefined })) }}
                required
                aria-required="true"
                aria-invalid={!!formErrors.payment_amount}
                aria-describedby={formErrors.payment_amount ? 'payment-amount-error' : undefined}
              />
              {paymentLiability && parseFloat(paymentLiability.remaining_amount || 0) > 0 && (
                <>
                  <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{t('common.max')}: {formatNum(paymentLiability.remaining_amount)}</span>
                  <button
                    type="button"
                    onClick={() => setPaymentFormData((prev) => ({ ...prev, payment_amount: String(paymentLiability.remaining_amount ?? '') }))}
                    className="px-2 py-1.5 text-xs font-medium rounded bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:hover:bg-amber-900/60"
                  >
                    {t('liabilities.payFullRemaining')}
                  </button>
                </>
              )}
            </div>
            {formErrors.payment_amount && <p id="payment-amount-error" className="text-xs text-red-600 dark:text-red-400 mt-0.5" role="alert">{formErrors.payment_amount}</p>}
          </div>
          <div>
            <label className="label text-xs" htmlFor="payment-date">{t('liabilities.paymentDate')}</label>
            <input
              id="payment-date"
              type="date"
              className="input w-full py-2 text-sm"
              value={paymentFormData.payment_date}
              onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_date: e.target.value })}
              required
              aria-required="true"
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
