import { useState, useEffect, useMemo } from 'react'
import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import { useLanguage } from '../../context/LanguageContext'
import LoadingSpinner from '../LoadingSpinner'
import TableSkeleton from '../TableSkeleton'
import Pagination from '../ui/Pagination'
import Dropdown from '../ui/Dropdown'
import { Printer, Wallet, Edit as EditIcon, Trash2, MoreVertical, Filter, Upload, FileText } from '../ui/Icons'
import { downloadCsv } from '../../utils/exportCsv'
import { generateInvoice } from '../../utils/generateInvoice'
import CsvImportModal from '../CsvImportModal'
import { getPaginationPrefs, setPaginationPrefs } from '../../utils/paginationPrefs'

const TRANSACTION_STATUS_OPTIONS = ['not_started', 'invoice', 'paused', 'paid', 'done']

function TransactionPage({ config }) {
  const {
    entityType,
    entityTable,
    entityIdField,
    entityNameField,
    entityRelationName,
    transactionTable,
    routeKey,
    translationKey,
    filterByLabelKey,
    primaryColor,
    csvFilename
  } = config

  const entityLabelKey = translationKey === 'clientTransactions' ? 'client' : 'supplier'
  const selectPlaceholderKey = translationKey === 'clientTransactions' ? 'selectClient' : 'selectSupplier'

  const [transactions, setTransactions] = useState([])
  const [entities, setEntities] = useState([])
  const [products, setProducts] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState(null)
  const [expandedRows, setExpandedRows] = useState(new Set())
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [includePastRemaining, setIncludePastRemaining] = useState(true)
  const [filterEntityId, setFilterEntityId] = useState('')
  const [filterProductId, setFilterProductId] = useState('')
  const [filterPaymentStatus, setFilterPaymentStatus] = useState('all') // all, outstanding, paid
  const [filterStatus, setFilterStatus] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [formData, setFormData] = useState(() => ({
    [entityIdField]: '',
    [entityNameField]: '',
    product_id: '',
    product_name: '',
    product_price: '',
    quantity: '',
    total_amount: '',
    paid_amount: '0',
    transaction_date: new Date().toISOString().split('T')[0],
    status: 'not_started'
  }))
  const [entitySuggestions, setEntitySuggestions] = useState([])
  const [productSuggestions, setProductSuggestions] = useState([])
  const [showEntitySuggestions, setShowEntitySuggestions] = useState(false)
  const [showProductSuggestions, setShowProductSuggestions] = useState(false)
  const [paymentFormData, setPaymentFormData] = useState({
    transaction_id: '',
    payment_amount: '',
    payment_date: new Date().toISOString().split('T')[0]
  })
  const [showCsvImportModal, setShowCsvImportModal] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100]
  const getStatusBadgeClasses = (status) => {
    const s = status || 'not_started'
    const map = {
      not_started: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
      invoice: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200',
      paused: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
      paid: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200',
      done: 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200'
    }
    return map[s] || map.not_started
  }

  // Restore from localStorage when URL has no params (e.g. after nav link to "/")
  useEffect(() => {
    if (searchParams.has('pageSize')) return
    const prefs = getPaginationPrefs(routeKey)
    if (prefs && PAGE_SIZE_OPTIONS.includes(prefs.pageSize)) {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev)
        p.set('page', String(prefs.page))
        p.set('pageSize', String(prefs.pageSize))
        return p
      })
    }
  }, [])

  // Apply paymentStatus from URL when navigating from Dashboard (e.g. /?paymentStatus=outstanding)
  useEffect(() => {
    const status = searchParams.get('paymentStatus')
    if (status === 'outstanding' || status === 'paid') setFilterPaymentStatus(status)
  }, [searchParams])

  const currentPage = Math.max(1, parseInt(searchParams.get('page'), 10) || 1)
  const pageSizeParam = searchParams.get('pageSize')
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(pageSizeParam)) ? Number(pageSizeParam) : 10

  const setPage = (page) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('page', String(page))
      return p
    })
    setPaginationPrefs(routeKey, { page, pageSize })
  }
  const setPageSizeAndReset = (size) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('pageSize', String(size))
      p.set('page', '1')
      return p
    })
    setPaginationPrefs(routeKey, { page: 1, pageSize: size })
  }

  const { success, error: showError } = useToast()
  const { t, language } = useLanguage()
  const formatNum = (n) => (Number(n) ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  const currency = t('common.currency')
  const formatCurrency = (n) => (language === 'ar' ? formatNum(n) + ' ' + currency : currency + ' ' + formatNum(n))

  useEffect(() => {
    fetchData()
    const unsubscribe = subscribeToChanges()
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.autocomplete-container')) {
        setShowEntitySuggestions(false)
        setShowProductSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      
      const [entitiesResult, productsResult, transactionsResult, paymentsResult] = await Promise.all([
        supabase.from(entityTable).select('*').order(entityNameField),
        supabase.from('products').select('*').order('product_name'),
        supabase
          .from(transactionTable)
          .select(`
            *,
            ${entityRelationName}:${entityIdField} (
              ${entityNameField},
              contact_info
            ),
            products:product_id (
              product_name,
              model,
              unit_price
            )
          `)
          .order('transaction_date', { ascending: false }),
        supabase.from('payments').select('*').eq('transaction_type', entityType).order('payment_date', { ascending: false })
      ])
      
      if (entitiesResult.error) throw entitiesResult.error
      if (productsResult.error) throw productsResult.error
      if (transactionsResult.error) throw transactionsResult.error
      if (paymentsResult.error) throw paymentsResult.error
      
      setEntities(entitiesResult.data || [])
      setProducts(productsResult.data || [])
      setTransactions(transactionsResult.data || [])
      setPayments(paymentsResult.data || [])
    } catch (err) {
      console.error('Error fetching data:', err)
      showError('Error loading data: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const TRANSACTION_SELECT = `
    *,
    ${entityRelationName}:${entityIdField} (
      ${entityNameField},
      contact_info
    ),
    products:product_id (
      product_name,
      model,
      unit_price
    )
  `

  const fetchOneTransaction = async (id) => {
    const { data, error } = await supabase
      .from(transactionTable)
      .select(TRANSACTION_SELECT)
      .eq('id', id)
      .single()
    if (error) return null
    return data
  }

  const subscribeToChanges = () => {
    const channel1 = supabase
      .channel(`${transactionTable}_changes`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: transactionTable
        },
        async (payload) => {
          const { eventType, new: newRow, old: oldRow } = payload
          if (eventType === 'INSERT' && newRow?.id) {
            const row = await fetchOneTransaction(newRow.id)
            if (row) setTransactions((prev) => [row, ...prev])
          } else if (eventType === 'UPDATE' && newRow?.id) {
            const row = await fetchOneTransaction(newRow.id)
            if (row) setTransactions((prev) => prev.map((t) => (t.id === row.id ? row : t)))
          } else if (eventType === 'DELETE' && oldRow?.id) {
            setTransactions((prev) => prev.filter((t) => t.id !== oldRow.id))
          }
        }
      )
      .subscribe()

    const channel2 = supabase
      .channel('payments_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'payments'
        },
        async (payload) => {
          const { eventType, new: newRow, old: oldRow } = payload
          const isOurType = (r) => r?.transaction_type === entityType
          const transactionId = newRow?.transaction_id ?? oldRow?.transaction_id
          if (!transactionId) return
          if (eventType === 'INSERT' && isOurType(newRow)) {
            setPayments((prev) => [newRow, ...prev])
            const row = await fetchOneTransaction(transactionId)
            if (row) setTransactions((prev) => prev.map((t) => (t.id === row.id ? row : t)))
          } else if (eventType === 'UPDATE' && (isOurType(newRow) || isOurType(oldRow))) {
            if (isOurType(newRow)) setPayments((prev) => prev.map((p) => (p.id === newRow.id ? newRow : p)))
            const row = await fetchOneTransaction(transactionId)
            if (row) setTransactions((prev) => prev.map((t) => (t.id === row.id ? row : t)))
          } else if (eventType === 'DELETE' && isOurType(oldRow)) {
            setPayments((prev) => prev.filter((p) => p.id !== oldRow.id))
            const row = await fetchOneTransaction(transactionId)
            if (row) setTransactions((prev) => prev.map((t) => (t.id === row.id ? row : t)))
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel1)
      supabase.removeChannel(channel2)
    }
  }

  const handleEntityInput = (value) => {
    setFormData({ ...formData, [entityNameField]: value, [entityIdField]: '' })
    if (value.length > 0) {
      const filtered = entities.filter(e =>
        (e[entityNameField] || '').toLowerCase().includes(value.toLowerCase())
      )
      setEntitySuggestions(filtered)
      setShowEntitySuggestions(true)
    } else {
      setEntitySuggestions([])
      setShowEntitySuggestions(false)
    }
  }

  const handleEntitySelect = (entity) => {
    setFormData({ ...formData, [entityIdField]: entity[entityIdField], [entityNameField]: entity[entityNameField] })
    setShowEntitySuggestions(false)
  }

  const handleProductInput = (value) => {
    setFormData({ ...formData, product_name: value, product_id: '' })
    if (value.length > 0) {
      const filtered = products.filter(p => 
        p.product_name.toLowerCase().includes(value.toLowerCase())
      )
      setProductSuggestions(filtered)
      setShowProductSuggestions(true)
    } else {
      setProductSuggestions([])
      setShowProductSuggestions(false)
    }
  }

  const handleProductSelect = (product) => {
    setFormData({ 
      ...formData, 
      product_id: product.product_id, 
      product_name: product.product_name,
      product_price: product.unit_price,
      total_amount: product.unit_price && formData.quantity ? (product.unit_price * formData.quantity).toFixed(2) : formData.total_amount
    })
    setShowProductSuggestions(false)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    
    try {
      // Handle entity (client/supplier) - create if doesn't exist
      let entityId = formData[entityIdField]
      if (!entityId && formData[entityNameField]) {
        const { data: existingEntity } = await supabase
          .from(entityTable)
          .select(entityIdField)
          .eq(entityNameField, formData[entityNameField].trim())
          .single()
        
        if (existingEntity) {
          entityId = existingEntity[entityIdField]
        } else {
          const { data: newEntity, error: entityError } = await supabase
            .from(entityTable)
            .insert([{ [entityNameField]: formData[entityNameField].trim() }])
            .select()
            .single()
          
          if (entityError) throw entityError
          entityId = newEntity[entityIdField]
        }
      }

      // Handle product - create if doesn't exist
      let productId = formData.product_id
      if (!productId && formData.product_name) {
        // Check if product exists
        const { data: existingProduct } = await supabase
          .from('products')
          .select('product_id')
          .eq('product_name', formData.product_name.trim())
          .single()
        
        if (existingProduct) {
          productId = existingProduct.product_id
        } else {
          // Create new product
          const unitPrice = formData.product_price ? parseFloat(formData.product_price) : 0
          const { data: newProduct, error: productError } = await supabase
            .from('products')
            .insert([{ 
              product_name: formData.product_name.trim(),
              unit_price: unitPrice
            }])
            .select()
            .single()
          
          if (productError) throw productError
          productId = newProduct.product_id
        }
      }

      const unitPrice = formData.product_price ? parseFloat(formData.product_price) : (formData.total_amount && formData.quantity ? parseFloat(formData.total_amount) / parseInt(formData.quantity) : 0)

      const transactionData = {
        [entityIdField]: parseInt(entityId),
        product_id: parseInt(productId),
        quantity: parseInt(formData.quantity),
        unit_price: unitPrice,
        total_amount: parseFloat(formData.total_amount),
        paid_amount: parseFloat(formData.paid_amount) || 0,
        remaining_amount: parseFloat(formData.total_amount) - (parseFloat(formData.paid_amount) || 0),
        transaction_date: formData.transaction_date,
        status: formData.status || 'not_started'
      }

      if (editingTransaction) {
        const transactionId = editingTransaction.transaction_id
        const newPaidAmount = parseFloat(formData.paid_amount) || 0
        
        const { error } = await supabase
          .from(transactionTable)
          .update(transactionData)
          .eq('transaction_id', transactionId)
        
        if (error) throw error
        
        const { data: existingPayments } = await supabase
          .from('payments')
          .select('payment_amount')
          .eq('transaction_id', transactionId)
          .eq('transaction_type', entityType)
        
        const currentPaymentsTotal = existingPayments?.reduce((sum, p) => sum + parseFloat(p.payment_amount || 0), 0) || 0
        
        if (newPaidAmount > currentPaymentsTotal) {
          const difference = newPaidAmount - currentPaymentsTotal
          const { error: paymentError } = await supabase
            .from('payments')
            .insert([{
              transaction_id: transactionId,
              transaction_type: entityType,
              payment_amount: difference,
              payment_date: formData.transaction_date
            }])
          
          if (paymentError) {
            console.error('Error syncing payment:', paymentError)
          }
        }
        
        success(t(`${translationKey}.transactionUpdated`))
      } else {
        const { data: newTransaction, error } = await supabase
          .from(transactionTable)
          .insert([transactionData])
          .select()
          .single()
        
        if (error) throw error
        
        const paidAmount = parseFloat(formData.paid_amount) || 0
        if (paidAmount > 0 && newTransaction) {
          const { error: paymentError } = await supabase
            .from('payments')
            .insert([{
              transaction_id: newTransaction.transaction_id,
              transaction_type: entityType,
              payment_amount: paidAmount,
              payment_date: formData.transaction_date
            }])
          
          if (paymentError) {
            console.error('Error creating initial payment:', paymentError)
          }
        }
        
        success(t(`${translationKey}.transactionCreated`))
      }

      setShowModal(false)
      setEditingTransaction(null)
      setFormData({
        [entityIdField]: '',
        [entityNameField]: '',
        product_id: '',
        product_name: '',
        product_price: '',
        quantity: '',
        total_amount: '',
        paid_amount: '0',
        transaction_date: new Date().toISOString().split('T')[0],
        status: 'not_started'
      })
      await fetchData()
    } catch (err) {
      console.error('Error saving transaction:', err)
      showError('Error saving transaction: ' + err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleEdit = (transaction) => {
    setEditingTransaction(transaction)
    const relation = transaction[entityRelationName]
    setFormData({
      [entityIdField]: transaction[entityIdField] ? transaction[entityIdField].toString() : '',
      product_id: transaction.product_id ? transaction.product_id.toString() : '',
      quantity: transaction.quantity.toString(),
      total_amount: transaction.total_amount.toString(),
      paid_amount: transaction.paid_amount.toString(),
      transaction_date: transaction.transaction_date,
      status: transaction.status || 'not_started',
      [entityNameField]: relation?.[entityNameField] || '',
      product_name: transaction.products?.product_name || '',
      product_price: (transaction.unit_price !== undefined && transaction.unit_price !== null)
        ? transaction.unit_price.toString()
        : (transaction.products?.unit_price !== undefined && transaction.products?.unit_price !== null ? transaction.products.unit_price.toString() : (transaction.quantity ? (parseFloat(transaction.total_amount) / transaction.quantity).toFixed(2) : ''))
    })
    setShowModal(true)
  }

  const handleDelete = async (transactionId) => {
    if (!window.confirm(t(`${translationKey}.deleteConfirm`))) return

    try {
      const { error: paymentsError } = await supabase
        .from('payments')
        .delete()
        .eq('transaction_id', transactionId)
        .eq('transaction_type', entityType)
      
      if (paymentsError) throw paymentsError
      
      const { error } = await supabase
        .from(transactionTable)
        .delete()
        .eq('transaction_id', transactionId)
      
      if (error) throw error
      success(t(`${translationKey}.transactionDeleted`))
      await fetchData()
    } catch (err) {
      console.error('Error deleting transaction:', err)
      showError('Error deleting transaction: ' + err.message)
    }
  }

  const getPaymentsForTransaction = (transactionId) => {
    const transactionIds = transactions.map(t => t.transaction_id)
    return payments.filter(p =>
      p.transaction_id === transactionId &&
      transactionIds.includes(p.transaction_id)
    )
  }

  const handleAddPayment = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    
    try {
      const transactionId = parseInt(paymentFormData.transaction_id)
      
      const { data: transaction, error: fetchError } = await supabase
        .from(transactionTable)
        .select('*')
        .eq('transaction_id', transactionId)
        .single()

      if (fetchError || !transaction) {
        throw new Error(`Transaction not found. Please ensure this is a ${entityType} transaction.`)
      }

      // Note: client_transactions and supplier_transactions each have their own
      // transaction_id sequence, so the same numeric ID can exist in both tables.
      // Payments are disambiguated by transaction_type; no need to check supplier_transactions.

      const remainingAmount = parseFloat(transaction.remaining_amount ?? 0)
      const paymentAmount = parseFloat(paymentFormData.payment_amount)
      if (isNaN(paymentAmount) || paymentAmount <= 0) {
        throw new Error('Please enter a valid payment amount.')
      }
      if (paymentAmount > remainingAmount) {
        throw new Error(
          `${t('paymentsBreakdown.paymentExceedsRemaining')}. Remaining: ${remainingAmount.toFixed(2)}, entered: ${paymentAmount.toFixed(2)}`
        )
      }

      // Calculate new amounts before inserting
      const newPaidAmount = parseFloat(transaction.paid_amount || 0) + paymentAmount
      const newRemainingAmount = parseFloat(transaction.total_amount) - newPaidAmount

      const { data: paymentData, error: paymentError } = await supabase
        .from('payments')
        .insert([{
          transaction_id: transactionId,
          transaction_type: entityType,
          payment_amount: paymentAmount,
          payment_date: paymentFormData.payment_date
        }])
        .select()

      if (paymentError) {
        console.error('Payment insert error details:', {
          error: paymentError,
          transactionId: transactionId,
          transaction: transaction
        })
        
        // If it's a foreign key constraint error, provide helpful message
        if (paymentError.message && paymentError.message.includes('foreign key')) {
          throw new Error(`Database constraint error: The payments table has foreign key constraints to both client and supplier transactions. The transaction_id ${transactionId} must exist in the correct table. Please check your database schema.`)
        }
        
        throw new Error(`Failed to add payment: ${paymentError.message}`)
      }

      const { error: updateError } = await supabase
        .from(transactionTable)
        .update({
          paid_amount: newPaidAmount,
          remaining_amount: newRemainingAmount
        })
        .eq('transaction_id', transactionId)

      if (updateError) {
        console.error('Update error:', updateError)
        throw updateError
      }

      success(t('paymentsBreakdown.paymentAdded'))
      setShowPaymentModal(false)
      setPaymentFormData({
        transaction_id: '',
        payment_amount: '',
        payment_date: new Date().toISOString().split('T')[0]
      })
      await fetchData()
    } catch (err) {
      console.error('Error adding payment:', err)
      showError('Error adding payment: ' + err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeletePayment = async (paymentId, transactionId) => {
    if (!window.confirm(t('paymentsBreakdown.deleteConfirm'))) return

    try {
      const { data: payment } = await supabase
        .from('payments')
        .select('payment_amount')
        .eq('payment_id', paymentId)
        .single()

      const { error: deleteError } = await supabase
        .from('payments')
        .delete()
        .eq('payment_id', paymentId)

      if (deleteError) throw deleteError

      const { data: transaction } = await supabase
        .from(transactionTable)
        .select('*')
        .eq('transaction_id', transactionId)
        .single()

      const newPaidAmount = Math.max(0, parseFloat(transaction.paid_amount || 0) - parseFloat(payment.payment_amount))
      const newRemainingAmount = parseFloat(transaction.total_amount) - newPaidAmount

      await supabase
        .from(transactionTable)
        .update({
          paid_amount: newPaidAmount,
          remaining_amount: newRemainingAmount
        })
        .eq('transaction_id', transactionId)

      success(t('paymentsBreakdown.paymentDeleted'))
    } catch (err) {
      console.error('Error deleting payment:', err)
      showError('Error deleting payment: ' + err.message)
    }
  }

  const toggleRowExpansion = (transactionId) => {
    const newExpanded = new Set(expandedRows)
    if (newExpanded.has(transactionId)) {
      newExpanded.delete(transactionId)
    } else {
      newExpanded.add(transactionId)
    }
    setExpandedRows(newExpanded)
  }

  const getFilteredTransactions = () => {
    let result = transactions

    // Month filter
    if (selectedMonth) {
      const [year, month] = selectedMonth.split('-')
      const selectedDate = new Date(parseInt(year), parseInt(month) - 1, 1)
      const nextMonth = new Date(parseInt(year), parseInt(month), 1)
      result = result.filter(t => {
        const transactionDate = new Date(t.transaction_date)
        if (includePastRemaining) {
          return (transactionDate >= selectedDate && transactionDate < nextMonth) ||
                 (transactionDate < selectedDate && parseFloat(t.remaining_amount || 0) > 0)
        }
        return transactionDate >= selectedDate && transactionDate < nextMonth
      })
    }

    // Entity filter
    if (filterEntityId) {
      result = result.filter(t => t[entityIdField] === parseInt(filterEntityId))
    }

    // Product filter
    if (filterProductId) {
      result = result.filter(t => t.product_id === parseInt(filterProductId))
    }

    // Payment status filter
    if (filterPaymentStatus === 'outstanding') {
      result = result.filter(t => parseFloat(t.remaining_amount || 0) > 0)
    } else if (filterPaymentStatus === 'paid') {
      result = result.filter(t => parseFloat(t.remaining_amount || 0) === 0)
    }

    // Status filter
    if (filterStatus && filterStatus !== 'all') {
      result = result.filter(t => (t.status || 'not_started') === filterStatus)
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      result = result.filter(t => {
        const relation = t[entityRelationName]
        const entityName = (relation?.[entityNameField] || '').toLowerCase()
        const productName = (t.products?.product_name || '').toLowerCase()
        const model = (t.products?.model || '').toLowerCase()
        return entityName.includes(q) || productName.includes(q) || model.includes(q)
      })
    }

    return result
  }

  const hasActiveFilters = filterEntityId || filterProductId || filterPaymentStatus !== 'all' || filterStatus !== 'all' || searchQuery.trim()
  const clearFilters = () => {
    setFilterEntityId('')
    setFilterProductId('')
    setFilterPaymentStatus('all')
    setFilterStatus('all')
    setSearchQuery('')
  }

  const filteredTransactions = getFilteredTransactions()

  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / pageSize))
  const effectivePage = Math.min(currentPage, totalPages)
  const paginatedTransactions = useMemo(() => {
    const start = (effectivePage - 1) * pageSize
    return filteredTransactions.slice(start, start + pageSize)
  }, [filteredTransactions, effectivePage, pageSize])

  const prevFiltersRef = React.useRef(null)
  useEffect(() => {
    const key = `${filterEntityId}|${filterProductId}|${filterPaymentStatus}|${filterStatus}|${searchQuery}|${selectedMonth}|${includePastRemaining}`
    if (prevFiltersRef.current !== null && prevFiltersRef.current !== key) {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev)
        p.set('page', '1')
        return p
      })
    }
    prevFiltersRef.current = key
  }, [filterEntityId, filterProductId, filterPaymentStatus, filterStatus, searchQuery, selectedMonth, includePastRemaining])

  const getPastRemainingTotal = () => {
    if (!selectedMonth || !includePastRemaining) return 0
    const [year, month] = selectedMonth.split('-')
    const selectedDate = new Date(parseInt(year), parseInt(month) - 1, 1)
    
    return transactions
      .filter(t => {
        const transactionDate = new Date(t.transaction_date)
        return transactionDate < selectedDate && parseFloat(t.remaining_amount || 0) > 0
      })
      .reduce((sum, t) => sum + parseFloat(t.remaining_amount || 0), 0)
  }

  const handleExportCsv = () => {
    if (!filteredTransactions || filteredTransactions.length === 0) {
      showError(t('common.noDataToExport'))
      return
    }

    const relationKey = translationKey === 'clientTransactions' ? 'client' : 'supplier'
    const rows = filteredTransactions.map((tx) => ({
      [t(`${translationKey}.date`)]: tx.transaction_date,
      [t(`${translationKey}.${relationKey}`)]: tx[entityRelationName]?.[entityNameField] || '',
      [t(`${translationKey}.product`)]: tx.products?.product_name || '',
      [t(`${translationKey}.quantity`)]: tx.quantity,
      [t(`${translationKey}.unitPrice`)]: tx.unit_price ?? (tx.quantity ? parseFloat(tx.total_amount) / tx.quantity : ''),
      [t(`${translationKey}.totalAmount`)]: tx.total_amount,
      [t(`${translationKey}.paidAmount`)]: tx.paid_amount,
      [t(`${translationKey}.remainingAmount`)]: tx.remaining_amount,
      [t('common.status')]: t('common.status_' + (tx.status || 'not_started').replace(/-/g, '_'))
    }))

    downloadCsv(csvFilename, rows)
  }

  const calculateTotal = () => {
    const monthTotal = filteredTransactions
      .filter(t => {
        if (!selectedMonth) return true
        const [year, month] = selectedMonth.split('-')
        const transactionDate = new Date(t.transaction_date)
        const selectedDate = new Date(parseInt(year), parseInt(month) - 1, 1)
        const nextMonth = new Date(parseInt(year), parseInt(month), 1)
        return transactionDate >= selectedDate && transactionDate < nextMonth
      })
      .reduce((sum, t) => sum + parseFloat(t.total_amount || 0), 0)
    
    return monthTotal + (includePastRemaining ? getPastRemainingTotal() : 0)
  }

  const calculatePaid = () => {
    const monthPaid = filteredTransactions
      .filter(t => {
        if (!selectedMonth) return true
        const [year, month] = selectedMonth.split('-')
        const transactionDate = new Date(t.transaction_date)
        const selectedDate = new Date(parseInt(year), parseInt(month) - 1, 1)
        const nextMonth = new Date(parseInt(year), parseInt(month), 1)
        return transactionDate >= selectedDate && transactionDate < nextMonth
      })
      .reduce((sum, t) => sum + parseFloat(t.paid_amount || 0), 0)
    
    return monthPaid
  }

  const calculateRemaining = () => {
    const monthRemaining = filteredTransactions
      .filter(t => {
        if (!selectedMonth) return true
        const [year, month] = selectedMonth.split('-')
        const transactionDate = new Date(t.transaction_date)
        const selectedDate = new Date(parseInt(year), parseInt(month) - 1, 1)
        const nextMonth = new Date(parseInt(year), parseInt(month), 1)
        return transactionDate >= selectedDate && transactionDate < nextMonth
      })
      .reduce((sum, t) => sum + parseFloat(t.remaining_amount || 0), 0)
    
    return monthRemaining + (includePastRemaining ? getPastRemainingTotal() : 0)
  }

  const handleCsvImport = async (rows) => {
    try {
    for (const row of rows) {
      let entityId = null
      const entityName = (row.client_name || '').trim()
      if (entityName) {
        const { data: existing } = await supabase.from(entityTable).select(entityIdField).eq(entityNameField, entityName).single()
        if (existing) {
          entityId = existing[entityIdField]
        } else {
          const { data: created, error: err } = await supabase.from(entityTable).insert([{ [entityNameField]: entityName }]).select().single()
          if (err) throw err
          entityId = created[entityIdField]
        }
      }
      let productId = null
      const productName = (row.product_name || '').trim()
      if (productName) {
        const { data: existing } = await supabase.from('products').select('product_id').eq('product_name', productName).single()
        if (existing) {
          productId = existing.product_id
        } else {
          const { data: created, error: err } = await supabase.from('products').insert([{ product_name: productName, unit_price: row.unit_price || 0 }]).select().single()
          if (err) throw err
          productId = created.product_id
        }
      }
      const total = parseFloat(row.total_amount) || 0
      const paid = parseFloat(row.paid_amount) || 0
      const transactionData = {
        [entityIdField]: entityId,
        product_id: productId,
        quantity: parseInt(row.quantity) || 1,
        unit_price: parseFloat(row.unit_price) || 0,
        total_amount: total,
        paid_amount: paid,
        remaining_amount: total - paid,
        transaction_date: row.transaction_date || new Date().toISOString().split('T')[0],
        status: 'not_started'
      }
      const { data: newTx, error: txErr } = await supabase.from(transactionTable).insert([transactionData]).select().single()
      if (txErr) throw txErr
      if (paid > 0 && newTx) {
        await supabase.from('payments').insert([{
          transaction_id: newTx.transaction_id,
          transaction_type: entityType,
          payment_amount: paid,
          payment_date: newTx.transaction_date
        }])
      }
    }
    await fetchData()
    setShowCsvImportModal(false)
    success(rows.length === 1 ? t(`${translationKey}.transactionCreated`) : t('common.importCsv') + ' – ' + rows.length + ' ' + (translationKey === 'clientTransactions' ? 'client' : 'supplier') + ' transactions')
    } catch (err) {
      console.error('CSV import error:', err)
      showError('Import failed: ' + (err?.message || err))
      throw err
    }
  }

  const resetForm = () => {
    setEditingTransaction(null)
    setFormData({
      [entityIdField]: '',
      [entityNameField]: '',
      product_id: '',
      product_name: '',
      product_price: '',
      quantity: '',
      total_amount: '',
      paid_amount: '0',
      transaction_date: new Date().toISOString().split('T')[0],
      status: 'not_started'
    })
    setEntitySuggestions([])
    setProductSuggestions([])
    setShowEntitySuggestions(false)
    setShowProductSuggestions(false)
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <div className="h-8 bg-gray-200 rounded w-64"></div>
          <div className="h-10 bg-gray-200 rounded w-40"></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white p-6 rounded shadow">
              <div className="h-4 bg-gray-200 rounded w-32 mb-2"></div>
              <div className="h-8 bg-gray-200 rounded w-24"></div>
            </div>
          ))}
        </div>
        <TableSkeleton rows={8} cols={8} />
      </div>
    )
  }

  return (
    <>
    <div className="flex flex-col space-y-2 pb-4">
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 print:hidden">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{t(`${translationKey}.title`)}</h2>
            <p className="text-gray-600 text-sm">{t(`${translationKey}.subtitle`)}</p>
          </div>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => window.print()} disabled={transactions.length === 0} className="btn btn-secondary flex items-center gap-2 py-1.5 px-3 text-sm">
              <Printer size={18} />
              {t('common.print')}
            </button>
            <button type="button" onClick={() => setShowCsvImportModal(true)} className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-1.5 px-3 rounded text-sm flex items-center gap-2">
              <Upload size={18} />
              {t('common.importCsv')}
            </button>
            <button type="button" onClick={handleExportCsv} className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-1.5 px-3 rounded text-sm">
              {t('common.exportCsv')}
            </button>
            <button onClick={() => { resetForm(); setShowModal(true) }} className={`bg-${primaryColor}-600 hover:bg-${primaryColor}-700 text-white font-semibold py-2 px-4 rounded text-sm`}>
              {t(`${translationKey}.addTransaction`)}
            </button>
          </div>
        </div>

        {/* Filters – card layout like Liabilities */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 print:hidden overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
              <Filter size={16} className="text-gray-500 dark:text-gray-400" />
              {t('common.filters')}
            </h3>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3 pb-3 border-b border-gray-200 dark:border-gray-700">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t(`${translationKey}.period`) || 'Period'}:</span>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => { if (selectedMonth) { const [y, m] = selectedMonth.split('-').map(Number); const d = new Date(y, m - 2, 1); setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) } }} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium" title="Previous month">‹</button>
                <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="input py-2 text-sm w-36 rounded-lg border-gray-300 dark:border-gray-600" aria-label="Period" />
                <button type="button" onClick={() => { if (selectedMonth) { const [y, m] = selectedMonth.split('-').map(Number); const d = new Date(y, m, 1); setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) } }} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium" title="Next month">›</button>
              </div>
              <button type="button" onClick={() => { const n = new Date(); setSelectedMonth(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`) }} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:hover:bg-blue-900/60">{t(`${translationKey}.currentMonth`)}</button>
              <button type="button" onClick={() => setSelectedMonth('')} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600">{t(`${translationKey}.allMonths`)}</button>
              {selectedMonth && (
                <label className="flex items-center gap-2 py-2 px-3 rounded-lg bg-gray-100 dark:bg-gray-700/50 hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer transition-colors ml-auto sm:ml-0">
                  <input type="checkbox" checked={includePastRemaining} onChange={(e) => setIncludePastRemaining(e.target.checked)} className="rounded border-gray-400 text-blue-600 focus:ring-blue-500" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Include past</span>
                </label>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('common.searchPlaceholder')}</label>
                <input type="search" className="input py-2 text-sm w-44 rounded-lg border-gray-300 dark:border-gray-600" placeholder={t('common.searchPlaceholder')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{t(filterByLabelKey)}</label>
                <select className="input py-2 text-sm w-44 rounded-lg border-gray-300 dark:border-gray-600" value={filterEntityId} onChange={(e) => setFilterEntityId(e.target.value)}>
                  <option value="">{t(filterByLabelKey)}</option>
                  {entities.map((e) => <option key={e[entityIdField]} value={e[entityIdField]}>{e[entityNameField]}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('common.filterByProduct')}</label>
                <select className="input py-2 text-sm w-44 rounded-lg border-gray-300 dark:border-gray-600" value={filterProductId} onChange={(e) => setFilterProductId(e.target.value)}>
                  <option value="">{t('common.filterByProduct')}</option>
                  {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.product_name}{p.model ? ` (${p.model})` : ''}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('common.paymentStatus')}</label>
                <select className="input py-2 text-sm w-40 rounded-lg border-gray-300 dark:border-gray-600" value={filterPaymentStatus} onChange={(e) => setFilterPaymentStatus(e.target.value)}>
                  <option value="all">{t('common.paymentStatus')}</option>
                  <option value="outstanding">{t('common.outstanding')}</option>
                  <option value="paid">{t('common.paidInFull')}</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('common.status')}</label>
                <select className="input py-2 text-sm w-36 rounded-lg border-gray-300 dark:border-gray-600" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  <option value="all">{t('common.all')}</option>
                  {TRANSACTION_STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{t('common.status_' + s.replace(/-/g, '_'))}</option>
                  ))}
                </select>
              </div>
              {hasActiveFilters && (
                <button type="button" onClick={clearFilters} className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                  {t('common.clearFilters')}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Summary cards - compact */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className={`bg-${primaryColor}-600 text-white p-2.5 rounded shadow`}><p className="text-xs font-medium">{t(`${translationKey}.totalAmount`)}</p><p className="text-lg font-bold">{formatCurrency(calculateTotal())}</p></div>
          <div className="bg-green-600 text-white p-2.5 rounded shadow"><p className="text-xs font-medium">{t(`${translationKey}.paidAmount`)}</p><p className="text-lg font-bold">{formatCurrency(calculatePaid())}</p></div>
          <div className="bg-red-600 text-white p-2.5 rounded shadow"><p className="text-xs font-medium">{t(`${translationKey}.remainingAmount`)}</p><p className="text-lg font-bold">{formatCurrency(calculateRemaining())}</p></div>
        </div>
      </div>

      {/* Table - grows with content, page scrolls */}
      <div className="bg-white dark:bg-gray-800 shadow rounded overflow-x-auto overflow-y-visible mt-2">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-xs">
            <thead className="bg-gray-100 dark:bg-gray-700/50 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-2 py-1 text-left font-semibold text-gray-700 dark:text-gray-200 uppercase w-20">{t(`${translationKey}.date`)}</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-700 dark:text-gray-200 uppercase w-[14%] min-w-0">{t(`${translationKey}.${entityLabelKey}`)}</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-700 dark:text-gray-200 uppercase w-[14%] min-w-0">{t(`${translationKey}.product`)}</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-700 dark:text-gray-200 uppercase w-14">{t(`${translationKey}.quantity`)}</th>
                <th className="px-2 py-1 text-right font-semibold text-gray-700 dark:text-gray-200 uppercase w-20">{t(`${translationKey}.unitPrice`)}</th>
                <th className="px-2 py-1 text-right font-semibold text-gray-700 dark:text-gray-200 uppercase w-20">{t(`${translationKey}.total`)}</th>
                <th className="px-2 py-1 text-right font-semibold text-gray-700 dark:text-gray-200 uppercase w-20">{t(`${translationKey}.paid`)}</th>
                <th className="px-2 py-1 text-right font-semibold text-gray-700 dark:text-gray-200 uppercase w-20">{t(`${translationKey}.remaining`)}</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-700 dark:text-gray-200 uppercase w-24">{t('common.status')}</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-700 dark:text-gray-200 uppercase w-28 print:hidden">{t(`${translationKey}.actions`)}</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan="10" className="px-2 py-4 text-center text-gray-500 text-sm">
                    {t(`${translationKey}.noTransactions`)}
                  </td>
                </tr>
              ) : (
                paginatedTransactions.map((transaction) => {
                const transactionPayments = getPaymentsForTransaction(transaction.transaction_id)
                const isExpanded = expandedRows.has(transaction.transaction_id)
                const unitPrice = transaction.unit_price ?? (transaction.quantity ? parseFloat(transaction.total_amount) / transaction.quantity : 0)
                return (
                  <React.Fragment key={transaction.transaction_id}>
                    <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <td className="px-2 py-1 whitespace-nowrap text-gray-900 dark:text-white">{new Date(transaction.transaction_date).toLocaleDateString()}</td>
                      <td className="table-cell-wrap px-2 py-1 font-medium max-w-[100px] truncate" title={transaction[entityRelationName]?.[entityNameField] || 'N/A'}>{transaction[entityRelationName]?.[entityNameField] || 'N/A'}</td>
                      <td className="table-cell-wrap px-2 py-1 max-w-[100px] truncate" title={`${transaction.products?.product_name || 'N/A'}${transaction.products?.model ? ` (${transaction.products.model})` : ''}`}>{transaction.products?.product_name || 'N/A'}{transaction.products?.model && <span className="text-gray-500 dark:text-gray-400 ml-0.5">({transaction.products.model})</span>}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-gray-900 dark:text-white">{transaction.quantity}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-right tabular-nums text-gray-900 dark:text-white">{formatCurrency(unitPrice)}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-right tabular-nums font-medium text-gray-900 dark:text-white">{formatCurrency(transaction.total_amount)}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-right tabular-nums text-green-700 dark:text-green-400">{formatCurrency(transaction.paid_amount)}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-right tabular-nums font-medium text-red-700 dark:text-red-400">{formatCurrency(transaction.remaining_amount)}</td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${getStatusBadgeClasses(transaction.status)}`}>
                          {t('common.status_' + (transaction.status || 'not_started').replace(/-/g, '_'))}
                        </span>
                      </td>
                      <td className="px-2 py-1 rtl-flip print:hidden whitespace-nowrap">
                        <Dropdown
                          trigger={<MoreVertical size={20} />}
                          align="right"
                          className="inline-block"
                          items={[
                            { label: t('paymentsBreakdown.payments') + ` (${transactionPayments.length})`, icon: Wallet, onClick: () => toggleRowExpansion(transaction.transaction_id) },
                            { label: (translationKey === 'clientTransactions' ? (t('clientTransactions.invoice') || 'Generate Invoice') : (t('supplierTransactions.invoice') || 'Generate Invoice')), icon: FileText, onClick: () => { try { generateInvoice(transaction, { currency, language }); success(t('common.saved') || 'Invoice generated') } catch (e) { showError(e?.message || 'Failed to generate invoice') } } },
                            { divider: true },
                            { label: t(`${translationKey}.edit`), icon: EditIcon, onClick: () => handleEdit(transaction) },
                            { label: t(`${translationKey}.delete`), icon: Trash2, danger: true, onClick: () => handleDelete(transaction.transaction_id) }
                          ]}
                        />
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan="10" className="px-2 py-0 align-top">
                          <div className="payment-detail-row py-2 pl-2 pr-1 -mr-1 border-l-4 border-blue-200 bg-gradient-to-r from-blue-50/80 to-transparent rounded-r mb-1">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 mb-1.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <h4 className="font-semibold text-gray-800 text-xs flex items-center gap-1">
                                  <span className="w-1.5 h-4 bg-blue-500 rounded"></span>
                                  {t('paymentsBreakdown.payments')}
                                </h4>
                                <div className="flex gap-2 text-xs">
                                  <span className="text-green-700 dark:text-green-400 font-medium">{t('dashboard.paid')}: {formatCurrency(transaction.paid_amount)}</span>
                                  <span className="text-red-600 dark:text-red-400 font-medium">{t('dashboard.remaining')}: {formatCurrency(transaction.remaining_amount)}</span>
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  setPaymentFormData({
                                    transaction_id: transaction.transaction_id,
                                    payment_amount: '',
                                    payment_date: new Date().toISOString().split('T')[0]
                                  })
                                  setShowPaymentModal(true)
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded shadow shrink-0"
                              >
                                <span>+</span> {t('paymentsBreakdown.addPayment')}
                              </button>
                            </div>
                            {transactionPayments.length > 0 ? (
                              <div className="space-y-1">
                                {transactionPayments.map((payment, idx) => (
                                  <div
                                    key={payment.payment_id}
                                    className="flex items-center justify-between gap-2 py-1.5 px-2 bg-white rounded border border-gray-200"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-green-100 text-green-700 font-semibold text-xs">
                                        {idx + 1}
                                      </span>
                                      <div>
                                        <p className="font-semibold text-green-700 dark:text-green-400 text-sm">{formatCurrency(payment.payment_amount)}</p>
                                        <p className="text-gray-500 text-xs">{new Date(payment.payment_date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</p>
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => handleDeletePayment(payment.payment_id, transaction.transaction_id)}
                                      className="flex-shrink-0 px-2 py-0.5 text-red-600 hover:bg-red-50 rounded text-xs font-medium"
                                    >
                                      {t('paymentsBreakdown.deletePayment')}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-gray-500 text-xs py-2 text-center bg-white rounded border border-dashed border-gray-300">
                                {t(translationKey === 'clientTransactions' ? 'paymentsBreakdown.noClientPayments' : 'paymentsBreakdown.noSupplierPayments')}
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              }))}
            </tbody>
          </table>
          {transactions.length === 0 && (
            <div className="text-center py-4">
              <p className="text-gray-500 text-sm font-medium">{t(`${translationKey}.noTransactions`)}</p>
              <p className="text-gray-400 text-xs mt-1">{t(`${translationKey}.noTransactionsDesc`)}</p>
            </div>
          )}
        </div>
        {filteredTransactions.length > 0 && (
          <Pagination
            currentPage={effectivePage}
            totalPages={totalPages}
            onPageChange={setPage}
            pageSize={pageSize}
            onPageSizeChange={(size) => setPageSizeAndReset(Number(size))}
            totalItems={filteredTransactions.length}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
          />
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed z-50 inset-0 flex items-center justify-center p-2 overflow-y-auto">
          <div 
            className="fixed inset-0 bg-gray-900 bg-opacity-75" 
            onClick={() => setShowModal(false)}
          />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[95vh] flex flex-col my-auto">
            <div className={`bg-${primaryColor}-600 px-4 py-2 flex-shrink-0`}>
              <h3 className="text-lg font-bold text-white">
                {editingTransaction ? t(`${translationKey}.editTransaction`) : t(`${translationKey}.addTransaction`)}
              </h3>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
              <div className="bg-white px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 overflow-y-auto">
                <div className="relative autocomplete-container sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t(`${translationKey}.${entityLabelKey}`)} *</label>
                  <input
                    type="text"
                    required
                    value={formData[entityNameField]}
                    onChange={(e) => handleEntityInput(e.target.value)}
                    onFocus={() => formData[entityNameField] && handleEntityInput(formData[entityNameField])}
                    placeholder={t(`${translationKey}.${selectPlaceholderKey}`)}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {showEntitySuggestions && entitySuggestions.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded shadow-lg max-h-40 overflow-auto">
                        {entitySuggestions.map((entity) => (
                          <div
                            key={entity[entityIdField]}
                            onClick={() => handleEntitySelect(entity)}
                            className="px-3 py-1.5 hover:bg-blue-50 cursor-pointer text-sm"
                          >
                            {entity[entityNameField]}
                          </div>
                        ))}
                      </div>
                    )}
                </div>
                <div className="relative autocomplete-container sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t(`${translationKey}.product`)} *</label>
                  <input
                    type="text"
                    required
                    value={formData.product_name}
                    onChange={(e) => handleProductInput(e.target.value)}
                    onFocus={() => formData.product_name && handleProductInput(formData.product_name)}
                    placeholder={t(`${translationKey}.selectProduct`)}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {showProductSuggestions && productSuggestions.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded shadow-lg max-h-40 overflow-auto">
                        {productSuggestions.map((product) => (
                          <div
                            key={product.product_id}
                            onClick={() => handleProductSelect(product)}
                            className="px-3 py-1.5 hover:bg-blue-50 cursor-pointer text-sm"
                          >
                            {product.product_name} - {formatCurrency(product.unit_price)}
                          </div>
                        ))}
                      </div>
                    )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t(`${translationKey}.unitPrice`)} *</label>
                  <input type="number" required step="0.01" min="0" value={formData.product_price}
                    onChange={(e) => {
                      const price = e.target.value
                      setFormData({ ...formData, product_price: price, total_amount: price && formData.quantity ? (parseFloat(price) * formData.quantity).toFixed(2) : formData.total_amount })
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t(`${translationKey}.quantity`)} *</label>
                  <input type="number" required min="1" value={formData.quantity}
                    onChange={(e) => {
                      const quantity = e.target.value
                      const price = formData.product_price || (formData.product_id ? products.find(p => p.product_id === parseInt(formData.product_id))?.unit_price : 0)
                      setFormData({ ...formData, quantity, total_amount: price ? (parseFloat(price) * quantity).toFixed(2) : formData.total_amount })
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t(`${translationKey}.totalAmount`)} *</label>
                  <input type="number" required step="0.01" min="0" value={formData.total_amount} onChange={(e) => setFormData({ ...formData, total_amount: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t(`${translationKey}.paidAmount`)}</label>
                  <input type="number" step="0.01" min="0" value={formData.paid_amount} onChange={(e) => setFormData({ ...formData, paid_amount: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t(`${translationKey}.transactionDate`)} *</label>
                  <input type="date" required value={formData.transaction_date} onChange={(e) => setFormData({ ...formData, transaction_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.status')}</label>
                  <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {TRANSACTION_STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{t('common.status_' + s.replace(/-/g, '_'))}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-2 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 flex-shrink-0 border-t">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 border border-gray-300 rounded text-gray-700 text-sm font-medium hover:bg-gray-100">
                  {t(`${translationKey}.cancel`)}
                </button>
                <button type="submit" disabled={submitting} className={`px-4 py-2 bg-${primaryColor}-600 text-white text-sm font-medium rounded hover:bg-${primaryColor}-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}>
                    {submitting ? <><LoadingSpinner size="sm" /><span>{t(`${translationKey}.saving`)}</span></> : <span>{editingTransaction ? t(`${translationKey}.updateTransaction`) : t(`${translationKey}.createTransaction`)}</span>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed z-50 inset-0 flex items-center justify-center p-2 overflow-y-auto">
          <div className="fixed inset-0 bg-gray-900 bg-opacity-75" onClick={() => setShowPaymentModal(false)} />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md max-h-[95vh] flex flex-col my-auto">
            <div className="bg-green-600 px-4 py-2 flex-shrink-0">
              <h3 className="text-lg font-bold text-white">{t('paymentsBreakdown.addPayment')}</h3>
            </div>
            <form onSubmit={handleAddPayment} className="flex flex-col min-h-0">
              <div className="bg-white px-4 py-3 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('paymentsBreakdown.paymentAmount')} *</label>
                  <input type="number" required step="0.01" min="0.01" value={paymentFormData.payment_amount} onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_amount: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500" placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('paymentsBreakdown.paymentDate')} *</label>
                  <input
                    type="date"
                    required
                    value={paymentFormData.payment_date}
                    onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  />
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-2 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 flex-shrink-0 border-t">
                <button type="button" onClick={() => setShowPaymentModal(false)} className="px-4 py-2 border border-gray-300 rounded text-gray-700 text-sm font-medium hover:bg-gray-100">{t(`${translationKey}.cancel`)}</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {submitting ? <><LoadingSpinner size="sm" /><span>{t('paymentsBreakdown.adding')}</span></> : <span>{t('paymentsBreakdown.addPayment')}</span>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <CsvImportModal
        isOpen={showCsvImportModal}
        onClose={() => setShowCsvImportModal(false)}
        onImport={handleCsvImport}
        type={entityType}
      />
    </>
  )
}

export default TransactionPage
