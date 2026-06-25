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
import { Printer, Wallet, Edit as EditIcon, Trash2, MoreVertical, Filter, Upload, FileText, Plus } from '../ui/Icons'
import { downloadCsv } from '../../utils/exportCsv'
import { generateInvoice } from '../../utils/generateInvoice'
import {
  isDraftInvoice,
  isIssuedInvoice,
  resolveInvoiceFields,
  buildInvoicePdfOptions,
} from '../../utils/invoiceService'
import { peekNextInvoiceNumber, syncInvoiceCounterFromNumbers } from '../../utils/invoiceSettings'
import {
  buildLineItemsPayload,
  calcLineTotal,
  emptyInvoiceLine,
  normalizeInvoiceLines,
} from '../../utils/invoiceLines'
import { computeInvoiceTax, WHT_RATE_OPTIONS, VAT_RATE } from '../../utils/invoiceTax'
import EtaCodeInput from '../EtaCodeInput'
import ClientStatementModal from '../ClientStatementModal'
import InvoiceModal from '../InvoiceModal'
import CsvImportModal from '../CsvImportModal'
import { getPaginationPrefs, setPaginationPrefs } from '../../utils/paginationPrefs'
import { nextStatusAfterPaymentChange } from '../../utils/transactionStatus'

const TRANSACTION_STATUS_OPTIONS = ['not_started', 'in_progress', 'invoice', 'paused', 'paid', 'done']

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
    csvFilename,
    invoicingEnabled = false,
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
  const defaultPaymentTerms = localStorage.getItem('defaultPaymentTerms') || 'none'
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
    status: 'not_started',
    invoice_number: '',
    payment_terms: defaultPaymentTerms,
    due_date: '',
    wht_rate: 0,
    vat_rate: VAT_RATE,
    eta_item_code: '',
    eta_item_name: '',
    eta_unit_type: 'EA'
  }))
  const [entitySuggestions, setEntitySuggestions] = useState([])
  const [productSuggestions, setProductSuggestions] = useState([])
  const [showEntitySuggestions, setShowEntitySuggestions] = useState(false)
  const [showProductSuggestions, setShowProductSuggestions] = useState(false)
  const [paymentFormData, setPaymentFormData] = useState({
    transaction_id: '',
    payment_amount: '',
    payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'cash',
    reference_number: ''
  })
  const [showCsvImportModal, setShowCsvImportModal] = useState(false)
  const [invoiceModalMode, setInvoiceModalMode] = useState(false)
  const [extraInvoiceLines, setExtraInvoiceLines] = useState([])
  const [etaCodes, setEtaCodes] = useState([])
  const [showStatementModal, setShowStatementModal] = useState(false)
  const [statementModalData, setStatementModalData] = useState(null)
  const [invoicePreview, setInvoicePreview] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const paymentDetailsRefs = React.useRef(new Map())
  const paymentModalContentRef = React.useRef(null)
  const paymentAmountInputRef = React.useRef(null)
  const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100]
  const getStatusBadgeClasses = (status) => {
    const s = status || 'not_started'
    const map = {
      not_started: 'bg-gray-100 text-gray-700',
      in_progress: 'bg-sky-100 text-sky-800',
      invoice: 'bg-blue-100 text-blue-800',
      paused: 'bg-amber-100 text-amber-800',
      paid: 'bg-green-100 text-green-800',
      done: 'bg-purple-100 text-purple-800'
    }
    return map[s] || map.not_started
  }

  useEffect(() => {
    if (!showPaymentModal) return
    if (paymentModalContentRef.current) paymentModalContentRef.current.scrollTop = 0
    if (paymentAmountInputRef.current) paymentAmountInputRef.current.focus()
  }, [showPaymentModal])

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
              unit_price,
              eta_item_code,
              eta_item_name,
              eta_unit_type
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

      if (invoicingEnabled && transactionsResult.data?.length) {
        syncInvoiceCounterFromNumbers(
          transactionsResult.data.map((tx) => tx.invoice_number).filter(Boolean)
        )
      }

      if (invoicingEnabled) {
        const { data: codesData, error: codesError } = await supabase
          .from('eta_item_codes')
          .select('*')
          .order('item_code')
        if (!codesError) setEtaCodes(codesData || [])
      }
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
      unit_price,
      eta_item_code,
      eta_item_name,
      eta_unit_type
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
    const next = {
      ...formData,
      product_id: product.product_id,
      product_name: product.product_name,
      product_price: product.unit_price,
      eta_item_code: product.eta_item_code || formData.eta_item_code || '',
      eta_item_name: product.eta_item_name || formData.eta_item_name || '',
      eta_unit_type: product.eta_unit_type || formData.eta_unit_type || 'EA',
    }
    if (invoiceModalMode) {
      const { netTotal } = getInvoiceCalc({ unit_price: product.unit_price })
      next.total_amount = netTotal > 0 ? netTotal.toFixed(2) : formData.total_amount
    } else {
      next.total_amount = product.unit_price && formData.quantity
        ? (product.unit_price * formData.quantity).toFixed(2)
        : formData.total_amount
    }
    setFormData(next)
    setShowProductSuggestions(false)
  }

  const getTransactionPayments = (transactionId) =>
    payments.filter((p) => p.transaction_id === transactionId)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const saveMode = e.nativeEvent?.submitter?.getAttribute('data-save-mode') || 'save'
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

      const totalAmountNum = Number.isFinite(parseFloat(formData.total_amount)) ? parseFloat(formData.total_amount) : 0
      const paidAmountNum = Number.isFinite(parseFloat(formData.paid_amount)) ? parseFloat(formData.paid_amount) : 0

      // Guard against NaN/negative values before hitting the DB CHECK constraints
      // (client_transactions_amounts_check + remaining_amount >= 0).
      if (totalAmountNum < 0 || paidAmountNum < 0) {
        throw new Error('Amounts cannot be negative')
      }
      if (paidAmountNum > totalAmountNum) {
        throw new Error('Paid amount cannot exceed total amount')
      }

      const linePayload = invoicingEnabled && invoiceModalMode
        ? buildLineItemsPayload(
            { quantity: formData.quantity, unit_price: formData.product_price },
            extraInvoiceLines
          )
        : null
      const taxBreakdown = linePayload
        ? computeInvoiceTax(linePayload.invoiceTotal, formData.wht_rate, formData.vat_rate)
        : null
      const invoiceTotalNum = Number.isFinite(taxBreakdown?.netTotal) ? taxBreakdown.netTotal : totalAmountNum
      const remainingAmountNum = Math.max(0, invoiceTotalNum - paidAmountNum)

      let invoiceNumber = formData.invoice_number || null
      let workflowStatus = formData.status

      if (invoicingEnabled && invoiceModalMode) {
        const resolved = resolveInvoiceFields({
          mode: saveMode === 'issue' ? 'issue' : saveMode === 'draft' ? 'draft' : 'save',
          formStatus: formData.status,
          invoiceNumber: formData.invoice_number,
          remainingAmount: remainingAmountNum,
        })
        invoiceNumber = resolved.invoice_number
        workflowStatus = resolved.status
      }

      const computedStatus = nextStatusAfterPaymentChange(workflowStatus, remainingAmountNum)

      const transactionData = {
        [entityIdField]: parseInt(entityId),
        product_id: parseInt(productId),
        quantity: parseInt(formData.quantity),
        unit_price: unitPrice,
        total_amount: invoiceTotalNum,
        paid_amount: paidAmountNum,
        remaining_amount: remainingAmountNum,
        transaction_date: formData.transaction_date,
        status: computedStatus,
        invoice_number: invoiceNumber,
        payment_terms: formData.payment_terms || 'none',
        due_date: formData.due_date || null,
        ...(invoicingEnabled && invoiceModalMode ? {
          line_items: linePayload.extras,
          subtotal_amount: taxBreakdown.subtotal,
          vat_rate: taxBreakdown.vatRate,
          vat_amount: taxBreakdown.vatAmount,
          wht_rate: taxBreakdown.whtRate,
          wht_amount: taxBreakdown.whtAmount,
          eta_item_code: formData.eta_item_code?.trim() || null,
          eta_item_name: formData.eta_item_name?.trim() || null,
          eta_unit_type: formData.eta_unit_type?.trim() || null,
        } : {}),
      }

      let savedTransaction = null

      if (editingTransaction) {
        const transactionId = editingTransaction.transaction_id
        const newPaidAmount = parseFloat(formData.paid_amount) || 0
        
        const { error } = await supabase
          .from(transactionTable)
          .update(transactionData)
          .eq('transaction_id', transactionId)
        
        if (error) throw error
        
        savedTransaction = { ...editingTransaction, ...transactionData, transaction_id: transactionId }
        
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
        
        if (!(invoicingEnabled && saveMode === 'issue')) {
          success(t(`${translationKey}.transactionUpdated`))
        }
      } else {
        const { data: newTransaction, error } = await supabase
          .from(transactionTable)
          .insert([transactionData])
          .select()
          .single()
        
        if (error) throw error
        savedTransaction = newTransaction
        
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
        
        if (!(invoicingEnabled && saveMode === 'issue')) {
          success(t(`${translationKey}.transactionCreated`))
        }
      }

      if (invoicingEnabled && saveMode === 'issue' && savedTransaction) {
        const txPayments = getTransactionPayments(savedTransaction.transaction_id)
        const selectedProduct = products.find((p) => p.product_id === parseInt(savedTransaction.product_id, 10))
        setInvoicePreview({
          transaction: {
            ...savedTransaction,
            line_items: linePayload?.extras || savedTransaction.line_items || [],
            [entityRelationName]: { [entityNameField]: formData[entityNameField] },
            products: {
              product_name: formData.product_name || selectedProduct?.product_name,
              model: selectedProduct?.model,
              unit_price: parseFloat(formData.product_price) || selectedProduct?.unit_price,
            },
          },
          payments: txPayments,
        })
        success(t('clientTransactions.invoiceIssuedSuccess'))
      }

      setShowModal(false)
      setInvoiceModalMode(false)
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
        status: 'not_started',
        invoice_number: '',
        payment_terms: defaultPaymentTerms,
        due_date: '',
        wht_rate: 0,
        vat_rate: VAT_RATE,
        eta_item_code: '',
        eta_item_name: '',
        eta_unit_type: 'EA'
      })
      await fetchData()
    } catch (err) {
      console.error('Error saving transaction:', err)
      showError('Error saving transaction: ' + err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleEdit = (transaction, asInvoice = false) => {
    setEditingTransaction(transaction)
    setInvoiceModalMode(invoicingEnabled && asInvoice)
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
        : (transaction.products?.unit_price !== undefined && transaction.products?.unit_price !== null ? transaction.products.unit_price.toString() : (transaction.quantity ? (parseFloat(transaction.total_amount) / transaction.quantity).toFixed(2) : '')),
      invoice_number: transaction.invoice_number || '',
      payment_terms: transaction.payment_terms || 'none',
      due_date: transaction.due_date || '',
      wht_rate: Number(transaction.wht_rate) || 0,
      vat_rate: transaction.vat_rate != null ? Number(transaction.vat_rate) : VAT_RATE,
      eta_item_code: transaction.eta_item_code || transaction.products?.eta_item_code || '',
      eta_item_name: transaction.eta_item_name || transaction.products?.eta_item_name || '',
      eta_unit_type: transaction.eta_unit_type || transaction.products?.eta_unit_type || 'EA'
    })
    setExtraInvoiceLines(
      normalizeInvoiceLines(transaction.line_items || []).map((line) => ({
        product_id: line.product_id ? String(line.product_id) : '',
        product_name: line.product_name,
        item_name: line.item_name || '',
        item_code: line.item_code || '',
        unit_type: line.unit_type || 'EA',
        quantity: String(line.quantity),
        unit_price: String(line.unit_price),
        line_total: String(line.line_total),
      }))
    )
    setShowModal(true)
  }

  // Live invoice tax breakdown (subtotal -> VAT 14% -> withholding -> net total)
  const getInvoiceCalc = (overrides = {}) => {
    const primary = {
      quantity: overrides.quantity ?? formData.quantity,
      unit_price: overrides.unit_price ?? formData.product_price,
    }
    const lines = overrides.lines ?? extraInvoiceLines
    const whtRate = overrides.wht_rate ?? formData.wht_rate
    const vatRate = overrides.vat_rate ?? formData.vat_rate
    const { invoiceTotal } = buildLineItemsPayload(primary, lines)
    return computeInvoiceTax(invoiceTotal, whtRate, vatRate)
  }

  const updateExtraLine = (index, field, value) => {
    setExtraInvoiceLines((prev) => {
      const next = [...prev]
      const line = { ...next[index], [field]: value }
      if (field === 'quantity' || field === 'unit_price') {
        line.line_total = String(calcLineTotal(line.quantity, line.unit_price))
      }
      next[index] = line
      const { netTotal } = getInvoiceCalc({ lines: next })
      setFormData((f) => ({ ...f, total_amount: netTotal > 0 ? netTotal.toFixed(2) : f.total_amount }))
      return next
    })
  }

  const addExtraInvoiceLine = () => {
    setExtraInvoiceLines((prev) => [...prev, emptyInvoiceLine()])
  }

  const removeExtraInvoiceLine = (index) => {
    setExtraInvoiceLines((prev) => {
      const next = prev.filter((_, i) => i !== index)
      const { netTotal } = getInvoiceCalc({ lines: next })
      setFormData((f) => ({ ...f, total_amount: netTotal > 0 ? netTotal.toFixed(2) : f.total_amount }))
      return next
    })
  }

  const handleWhtRateChange = (rate) => {
    const whtRate = Number(rate) || 0
    const { netTotal } = getInvoiceCalc({ wht_rate: whtRate })
    setFormData((f) => ({ ...f, wht_rate: whtRate, total_amount: netTotal > 0 ? netTotal.toFixed(2) : f.total_amount }))
  }

  const handleVatToggle = (apply) => {
    const vatRate = apply ? VAT_RATE : 0
    const { netTotal } = getInvoiceCalc({ vat_rate: vatRate })
    setFormData((f) => ({ ...f, vat_rate: vatRate, total_amount: netTotal > 0 ? netTotal.toFixed(2) : f.total_amount }))
  }

  const openInvoiceModal = () => {
    resetForm()
    setInvoiceModalMode(true)
    setFormData((prev) => ({
      ...prev,
      status: 'not_started',
      paid_amount: '0',
      payment_terms: defaultPaymentTerms,
      due_date: calcDueDate(new Date().toISOString().split('T')[0], defaultPaymentTerms),
      wht_rate: 0,
      vat_rate: VAT_RATE,
    }))
    setShowModal(true)
  }

  const handlePrintInvoice = (transaction) => {
    const transactionPayments = getTransactionPayments(transaction.transaction_id)
    setInvoicePreview({ transaction, payments: transactionPayments })
  }

  const handleIssueInvoice = async (transaction) => {
    if (!isDraftInvoice(transaction)) return
    setSubmitting(true)
    try {
      const remaining = parseFloat(transaction.remaining_amount || 0)
      const resolved = resolveInvoiceFields({
        mode: 'issue',
        formStatus: transaction.status,
        invoiceNumber: '',
        remainingAmount: remaining,
      })
      const newStatus = nextStatusAfterPaymentChange(resolved.status, remaining)
      const { data, error } = await supabase
        .from(transactionTable)
        .update({
          invoice_number: resolved.invoice_number,
          status: newStatus,
        })
        .eq('transaction_id', transaction.transaction_id)
        .select(`*, ${entityRelationName}:${entityIdField} (${entityNameField}), products:product_id (product_name, model, unit_price, eta_item_code, eta_item_name, eta_unit_type)`)
        .single()
      if (error) throw error
      const transactionPayments = getTransactionPayments(transaction.transaction_id)
      setInvoicePreview({ transaction: data, payments: transactionPayments })
      success(t('clientTransactions.invoiceIssuedSuccess'))
      await fetchData()
    } catch (err) {
      showError(err?.message || 'Failed to issue invoice')
    } finally {
      setSubmitting(false)
    }
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
      const nextStatus = nextStatusAfterPaymentChange(transaction.status, newRemainingAmount)

      const { data: paymentData, error: paymentError } = await supabase
        .from('payments')
        .insert([{
          transaction_id: transactionId,
          transaction_type: entityType,
          payment_amount: paymentAmount,
          payment_date: paymentFormData.payment_date,
          payment_method: paymentFormData.payment_method || 'cash',
          reference_number: paymentFormData.reference_number || null
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
          remaining_amount: newRemainingAmount,
          status: nextStatus
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
        payment_date: new Date().toISOString().split('T')[0],
        payment_method: 'cash',
        reference_number: ''
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
      const nextStatus = nextStatusAfterPaymentChange(transaction.status, newRemainingAmount)

      await supabase
        .from(transactionTable)
        .update({
          paid_amount: newPaidAmount,
          remaining_amount: newRemainingAmount,
          status: nextStatus
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

    // When opening payments, auto-scroll to the expanded section.
    if (!expandedRows.has(transactionId)) {
      requestAnimationFrame(() => {
        const el = paymentDetailsRefs.current.get(transactionId)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      })
    }
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

  // Transaction IDs that match current filters (entity, product, status, search) — used for payment-date-based paid
  const filteredTransactionIds = useMemo(() => {
    let result = transactions
    if (filterEntityId) result = result.filter(t => t[entityIdField] === parseInt(filterEntityId))
    if (filterProductId) result = result.filter(t => t.product_id === parseInt(filterProductId))
    if (filterPaymentStatus === 'outstanding') result = result.filter(t => parseFloat(t.remaining_amount || 0) > 0)
    else if (filterPaymentStatus === 'paid') result = result.filter(t => parseFloat(t.remaining_amount || 0) === 0)
    if (filterStatus && filterStatus !== 'all') result = result.filter(t => (t.status || 'not_started') === filterStatus)
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
    return new Set(result.map(t => t.transaction_id))
  }, [transactions, filterEntityId, filterProductId, filterPaymentStatus, filterStatus, searchQuery, entityIdField, entityRelationName, entityNameField])

  const monthBounds = useMemo(() => {
    if (!selectedMonth) return null
    const [year, month] = selectedMonth.split('-')
    const start = new Date(parseInt(year), parseInt(month) - 1, 1)
    const end = new Date(parseInt(year), parseInt(month), 1) // exclusive
    return { start, end }
  }, [selectedMonth])

  const paidMapsByTransactionId = useMemo(() => {
    if (!monthBounds) return { inMonth: new Map(), beforeMonth: new Map() }
    const inMonth = new Map()
    const beforeMonth = new Map()

    for (const p of payments) {
      const txId = p.transaction_id
      if (!txId) continue
      const amt = parseFloat(p.payment_amount || 0) || 0
      if (amt === 0) continue

      const d = new Date(p.payment_date)
      if (Number.isNaN(d.getTime())) continue

      if (d >= monthBounds.start && d < monthBounds.end) {
        inMonth.set(txId, (inMonth.get(txId) || 0) + amt)
      } else if (d < monthBounds.start) {
        beforeMonth.set(txId, (beforeMonth.get(txId) || 0) + amt)
      }
    }

    return { inMonth, beforeMonth }
  }, [payments, monthBounds])

  const calculatePaid = () => {
    const monthStart = monthBounds?.start
    const monthEndExclusive = monthBounds?.end
    if (!selectedMonth) {
      // All Months: sum the payments table (source of truth) filtered by the
      // current entity/product/status/search filters, so the All-Months total
      // matches the sum of the per-month breakdowns.
      return payments
        .filter(p => filteredTransactionIds.has(p.transaction_id))
        .reduce((sum, p) => sum + parseFloat(p.payment_amount || 0), 0)
    }
    if (!monthStart || !monthEndExclusive) return 0
    return payments
      .filter(p => {
        const d = new Date(p.payment_date)
        if (d < monthStart || d >= monthEndExclusive) return false
        return filteredTransactionIds.has(p.transaction_id)
      })
      .reduce((sum, p) => sum + parseFloat(p.payment_amount || 0), 0)
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

  const openStatementModal = () => {
    if (entityType !== 'client' || !filterEntityId) return

    const clientTx = transactions.filter((tx) => String(tx[entityIdField]) === String(filterEntityId))
    const txIds = new Set(clientTx.map((tx) => tx.transaction_id))
    const clientPayments = payments.filter((p) => {
      if (txIds.has(p.transaction_id)) return true
      if (p.transaction_id == null && String(p.client_id) === String(filterEntityId)) return true
      return false
    })

    if (clientTx.length === 0 && clientPayments.length === 0) {
      showError(t('entities.statementNoData'))
      return
    }

    const client = entities.find((e) => String(e[entityIdField]) === String(filterEntityId))

    let dateFrom = ''
    let dateTo = ''
    if (selectedMonth) {
      const [year, month] = selectedMonth.split('-').map(Number)
      dateFrom = `${year}-${String(month).padStart(2, '0')}-01`
      const lastDay = new Date(year, month, 0).getDate()
      dateTo = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    } else {
      const year = new Date().getFullYear()
      dateFrom = `${year}-01-01`
      dateTo = `${year}-12-31`
    }

    setStatementModalData({
      client: client || {
        client_name: clientTx[0]?.[entityRelationName]?.[entityNameField] || 'Client',
        contact_info: clientTx[0]?.[entityRelationName]?.contact_info || '',
        address: clientTx[0]?.[entityRelationName]?.address || '',
      },
      transactions: clientTx,
      payments: clientPayments,
      dateFrom,
      dateTo,
    })
    setShowStatementModal(true)
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

  const previousPaidTotal = useMemo(() => {
    if (!monthBounds?.start) return 0
    const start = monthBounds.start
    return payments
      .filter((p) => {
        const d = new Date(p.payment_date)
        if (Number.isNaN(d.getTime())) return false
        if (d >= start) return false
        return filteredTransactionIds.has(p.transaction_id)
      })
      .reduce((sum, p) => sum + parseFloat(p.payment_amount || 0), 0)
  }, [payments, monthBounds?.start, filteredTransactionIds])

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

  const monthTotals = useMemo(() => {
    if (!selectedMonth) return { monthTotal: calculateTotal(), monthRemaining: calculateRemaining() }
    if (!selectedMonth.includes('-')) return { monthTotal: calculateTotal(), monthRemaining: calculateRemaining() }
    const [year, month] = selectedMonth.split('-')
    const selectedDate = new Date(parseInt(year), parseInt(month) - 1, 1)
    const nextMonth = new Date(parseInt(year), parseInt(month), 1)

    const monthTotal = filteredTransactions
      .filter((t) => {
        const d = new Date(t.transaction_date)
        return d >= selectedDate && d < nextMonth
      })
      .reduce((sum, t) => sum + parseFloat(t.total_amount || 0), 0)

    const monthRemaining = filteredTransactions
      .filter((t) => {
        const d = new Date(t.transaction_date)
        return d >= selectedDate && d < nextMonth
      })
      .reduce((sum, t) => sum + parseFloat(t.remaining_amount || 0), 0)

    return { monthTotal, monthRemaining }
  }, [selectedMonth, filteredTransactions])

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

  const calcDueDate = (txDate, terms) => {
    if (!txDate || !terms || terms === 'none') return ''
    const d = new Date(txDate)
    const daysMap = { cod: 0, net_15: 15, net_30: 30, net_60: 60, net_90: 90 }
    const days = daysMap[terms]
    if (days === undefined) return ''
    d.setDate(d.getDate() + days)
    return d.toISOString().split('T')[0]
  }

  const PAYMENT_TERMS_OPTIONS = [
    { value: 'none', label: t('common.paymentTerms_none') },
    { value: 'cod', label: t('common.paymentTerms_cod') },
    { value: 'net_15', label: t('common.paymentTerms_net_15') },
    { value: 'net_30', label: t('common.paymentTerms_net_30') },
    { value: 'net_60', label: t('common.paymentTerms_net_60') },
    { value: 'net_90', label: t('common.paymentTerms_net_90') },
  ]

  const PAYMENT_METHOD_OPTIONS = [
    { value: 'cash', label: t('common.paymentMethod_cash') },
    { value: 'bank_transfer', label: t('common.paymentMethod_bank_transfer') },
    { value: 'check', label: t('common.paymentMethod_check') },
    { value: 'credit_card', label: t('common.paymentMethod_credit_card') },
    { value: 'other', label: t('common.paymentMethod_other') },
  ]

  const resetForm = () => {
    setEditingTransaction(null)
    setInvoiceModalMode(false)
    setExtraInvoiceLines([])
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
      status: 'not_started',
      invoice_number: '',
      payment_terms: defaultPaymentTerms,
      due_date: '',
      wht_rate: 0,
      vat_rate: VAT_RATE,
      eta_item_code: '',
      eta_item_name: '',
      eta_unit_type: 'EA'
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
            {entityType === 'client' && filterEntityId && (
              <button
                type="button"
                onClick={openStatementModal}
                className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-1.5 px-3 rounded text-sm flex items-center gap-2"
              >
                <Printer size={18} />
                {t('entities.accountStatement')}
              </button>
            )}
            <button
              type="button"
              onClick={() => (invoicingEnabled ? openInvoiceModal() : (resetForm(), setShowModal(true)))}
              className={`bg-${primaryColor}-600 hover:bg-${primaryColor}-700 text-white font-semibold py-2 px-4 rounded text-sm`}
            >
              {invoicingEnabled ? t('clientTransactions.createInvoice') : t(`${translationKey}.addTransaction`)}
            </button>
          </div>
        </div>

        {/* Filters – card layout like Liabilities */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 print:hidden overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Filter size={16} className="text-gray-500" />
              {t('common.filters')}
            </h3>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3 pb-3 border-b border-gray-200">
              <span className="text-xs font-medium text-gray-500">{t(`${translationKey}.period`) || 'Period'}:</span>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => { if (selectedMonth) { const [y, m] = selectedMonth.split('-').map(Number); const d = new Date(y, m - 2, 1); setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) } }} className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium" title="Previous month">‹</button>
                <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="input py-2 text-sm w-36 rounded-lg border-gray-300" aria-label="Period" />
                <button type="button" onClick={() => { if (selectedMonth) { const [y, m] = selectedMonth.split('-').map(Number); const d = new Date(y, m, 1); setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) } }} className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium" title="Next month">›</button>
              </div>
              <button type="button" onClick={() => { const n = new Date(); setSelectedMonth(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`) }} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-100 text-blue-800 hover:bg-blue-200">{t(`${translationKey}.currentMonth`)}</button>
              <button type="button" onClick={() => setSelectedMonth('')} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200">{t(`${translationKey}.allMonths`)}</button>
              {selectedMonth && (
                <label className="flex items-center gap-2 py-2 px-3 rounded-lg bg-gray-100 hover:bg-gray-200 cursor-pointer transition-colors ml-auto sm:ml-0">
                  <input type="checkbox" checked={includePastRemaining} onChange={(e) => setIncludePastRemaining(e.target.checked)} className="rounded border-gray-400 text-blue-600 focus:ring-blue-500" />
                  <span className="text-sm text-gray-700">Include past</span>
                </label>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">{t('common.searchPlaceholder')}</label>
                <input type="search" className="input py-2 text-sm w-44 rounded-lg border-gray-300" placeholder={t('common.searchPlaceholder')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">{t(filterByLabelKey)}</label>
                <select className="input py-2 text-sm w-44 rounded-lg border-gray-300" value={filterEntityId} onChange={(e) => setFilterEntityId(e.target.value)}>
                  <option value="">{t(filterByLabelKey)}</option>
                  {entities.map((e) => <option key={e[entityIdField]} value={e[entityIdField]}>{e[entityNameField]}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">{t('common.filterByProduct')}</label>
                <select className="input py-2 text-sm w-44 rounded-lg border-gray-300" value={filterProductId} onChange={(e) => setFilterProductId(e.target.value)}>
                  <option value="">{t('common.filterByProduct')}</option>
                  {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.product_name}{p.model ? ` (${p.model})` : ''}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">{t('common.paymentStatus')}</label>
                <select className="input py-2 text-sm w-40 rounded-lg border-gray-300" value={filterPaymentStatus} onChange={(e) => setFilterPaymentStatus(e.target.value)}>
                  <option value="all">{t('common.paymentStatus')}</option>
                  <option value="outstanding">{t('common.outstanding')}</option>
                  <option value="paid">{t('common.paidInFull')}</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">{t('common.status')}</label>
                <select className="input py-2 text-sm w-36 rounded-lg border-gray-300" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  <option value="all">{t('common.all')}</option>
                  {TRANSACTION_STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{t('common.status_' + s.replace(/-/g, '_'))}</option>
                  ))}
                </select>
              </div>
              {hasActiveFilters && (
                <button type="button" onClick={clearFilters} className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg">
                  {t('common.clearFilters')}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Summary cards - compact */}
        {selectedMonth ? (
          <div className="space-y-3">
            <div>
              <div className={`px-4 py-2.5 bg-${primaryColor}-600 border border-b-0 border-${primaryColor}-700 rounded-t-lg shadow-sm text-center`}>
                <h4 className="text-sm md:text-base font-bold text-white tracking-wide">{t(`${translationKey}.summaryCurrentMonth`)}</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 p-2 bg-white border border-gray-200 rounded-b-lg">
                <div className={`bg-${primaryColor}-600 text-white p-2.5 rounded shadow`}>
                  <p className="text-xs font-medium">{t(`${translationKey}.monthTotalLabel`)}</p>
                  <p className="text-lg font-bold">{formatCurrency(monthTotals.monthTotal)}</p>
                  <p className="text-[11px] opacity-90">{t(`${translationKey}.monthTotalHint`)}</p>
                </div>
                <div className="bg-red-600 text-white p-2.5 rounded shadow">
                  <p className="text-xs font-medium">{t(`${translationKey}.monthOutstandingLabel`)}</p>
                  <p className="text-lg font-bold">{formatCurrency(monthTotals.monthRemaining)}</p>
                  <p className="text-[11px] opacity-90">{t(`${translationKey}.monthOutstandingHint`)}</p>
                </div>
                <div className="bg-green-600 text-white p-2.5 rounded shadow">
                  <p className="text-xs font-medium">{t(`${translationKey}.monthPaidLabel`)}</p>
                  <p className="text-lg font-bold">{formatCurrency(calculatePaid())}</p>
                  <p className="text-[11px] opacity-90">{t(`${translationKey}.monthPaidHint`)}</p>
                </div>
              </div>
            </div>

            <div>
              <div className="px-4 py-2.5 bg-slate-700 border border-b-0 border-slate-800 rounded-t-lg shadow-sm text-center">
                <h4 className="text-sm md:text-base font-bold text-white tracking-wide">{t(`${translationKey}.summaryPreviousTotals`)}</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 p-2 bg-white border border-gray-200 rounded-b-lg">
                <div className="bg-slate-700 text-white p-2.5 rounded shadow">
                  <p className="text-xs font-medium">{t(`${translationKey}.pastOutstandingLabel`)}</p>
                  <p className="text-lg font-bold">{formatCurrency(includePastRemaining ? getPastRemainingTotal() : 0)}</p>
                  <p className="text-[11px] opacity-90">{t(`${translationKey}.pastOutstandingHint`)}</p>
                </div>
                <div className="bg-slate-600 text-white p-2.5 rounded shadow">
                  <p className="text-xs font-medium">{t(`${translationKey}.pastPaidLabel`)}</p>
                  <p className="text-lg font-bold">{formatCurrency(previousPaidTotal)}</p>
                  <p className="text-[11px] opacity-90">{t(`${translationKey}.pastPaidHint`)}</p>
                </div>
                <div className="bg-gray-900 text-white p-2.5 rounded shadow">
                  <p className="text-xs font-medium">{t(`${translationKey}.totalOutstandingLabel`)}</p>
                  <p className="text-lg font-bold">{formatCurrency(calculateRemaining())}</p>
                  <p className="text-[11px] opacity-90">{t(`${translationKey}.totalOutstandingHint`)}</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className={`bg-${primaryColor}-600 text-white p-2.5 rounded shadow`}><p className="text-xs font-medium">{t(`${translationKey}.totalAmount`)}</p><p className="text-lg font-bold">{formatCurrency(calculateTotal())}</p></div>
            <div className="bg-green-600 text-white p-2.5 rounded shadow"><p className="text-xs font-medium">{t(`${translationKey}.paidAmount`)}</p><p className="text-lg font-bold">{formatCurrency(calculatePaid())}</p></div>
            <div className="bg-red-600 text-white p-2.5 rounded shadow"><p className="text-xs font-medium">{t(`${translationKey}.remainingAmount`)}</p><p className="text-lg font-bold">{formatCurrency(calculateRemaining())}</p></div>
          </div>
        )}
      </div>

      {/* Table - grows with content, page scrolls */}
      <div className="bg-white shadow rounded overflow-x-auto overflow-y-visible mt-2">
        <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-100 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-2 py-1 text-left font-semibold text-gray-700 uppercase w-20">{t(`${translationKey}.date`)}</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-700 uppercase w-20">{t('common.invoiceNumber')}</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-700 uppercase w-[14%] min-w-0">{t(`${translationKey}.${entityLabelKey}`)}</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-700 uppercase w-[14%] min-w-0">{t(`${translationKey}.product`)}</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-700 uppercase w-14">{t(`${translationKey}.quantity`)}</th>
                <th className="px-2 py-1 text-right font-semibold text-gray-700 uppercase w-20">{t(`${translationKey}.unitPrice`)}</th>
                <th className="px-2 py-1 text-right font-semibold text-gray-700 uppercase w-20">{t(`${translationKey}.total`)}</th>
                <th className="px-2 py-1 text-right font-semibold text-gray-700 uppercase w-20">{t(`${translationKey}.paid`)}</th>
                <th className="px-2 py-1 text-right font-semibold text-gray-700 uppercase w-20">{t(`${translationKey}.remaining`)}</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-700 uppercase w-20">{t('common.dueDate')}</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-700 uppercase w-24">{t('common.status')}</th>
                <th className="px-2 py-1 text-left font-semibold text-gray-700 uppercase w-28 print:hidden">{t(`${translationKey}.actions`)}</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan="12" className="px-2 py-4 text-center text-gray-500 text-sm">
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
                    <tr className="hover:bg-gray-50 transition-colors">
                      <td className="px-2 py-1 whitespace-nowrap text-gray-900">{new Date(transaction.transaction_date).toLocaleDateString()}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-gray-600 text-xs">
                        {transaction.invoice_number ? (
                          <span className="font-medium text-gray-800">{transaction.invoice_number}</span>
                        ) : invoicingEnabled && isDraftInvoice(transaction) ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold uppercase">
                            {t('clientTransactions.invoiceDraft')}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="table-cell-wrap px-2 py-1 font-medium max-w-[100px] truncate" title={transaction[entityRelationName]?.[entityNameField] || 'N/A'}>{transaction[entityRelationName]?.[entityNameField] || 'N/A'}</td>
                      <td className="table-cell-wrap px-2 py-1 max-w-[100px] truncate" title={`${transaction.products?.product_name || 'N/A'}${transaction.products?.model ? ` (${transaction.products.model})` : ''}`}>{transaction.products?.product_name || 'N/A'}{transaction.products?.model && <span className="text-gray-500 ml-0.5">({transaction.products.model})</span>}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-gray-900">{transaction.quantity}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-right tabular-nums text-gray-900">{formatCurrency(unitPrice)}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-right tabular-nums font-medium text-gray-900">{formatCurrency(transaction.total_amount)}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-right tabular-nums text-green-700">
                        {selectedMonth ? (
                          <div className="leading-tight">
                            <div className="font-semibold">{formatCurrency(paidMapsByTransactionId.inMonth.get(transaction.transaction_id) || 0)}</div>
                            {(paidMapsByTransactionId.beforeMonth.get(transaction.transaction_id) || 0) > 0 && (
                              <div className="text-[10px] text-gray-500">
                                +{formatCurrency(paidMapsByTransactionId.beforeMonth.get(transaction.transaction_id) || 0)}
                              </div>
                            )}
                          </div>
                        ) : (
                          formatCurrency(transaction.paid_amount)
                        )}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap text-right tabular-nums font-medium text-red-700">{formatCurrency(transaction.remaining_amount)}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-gray-600">
                        {transaction.due_date ? (
                          <>
                            <span>{new Date(transaction.due_date).toLocaleDateString()}</span>
                            {parseFloat(transaction.remaining_amount || 0) > 0 && new Date(transaction.due_date) < new Date() && (
                              <span className="ml-1 inline-flex items-center px-1 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-semibold">{t('common.overdue')}</span>
                            )}
                          </>
                        ) : '—'}
                      </td>
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
                            ...(invoicingEnabled
                              ? [
                                  ...(isDraftInvoice(transaction)
                                    ? [{ label: t('clientTransactions.issueInvoice'), icon: FileText, onClick: () => handleIssueInvoice(transaction) }]
                                    : []),
                                  ...(isIssuedInvoice(transaction)
                                    ? [{ label: t('clientTransactions.printInvoice'), icon: FileText, onClick: () => handlePrintInvoice(transaction) }]
                                    : []),
                                ]
                              : [{
                                  label: (translationKey === 'clientTransactions' ? t('clientTransactions.invoice') : t('supplierTransactions.invoice')) + ` (${t('common.beta')})`,
                                  icon: FileText,
                                  onClick: async () => {
                                    try {
                                      await generateInvoice(transaction, { ...buildInvoicePdfOptions(language, currency), payments: transactionPayments })
                                      success(t('common.saved') || 'Invoice generated')
                                    } catch (e) {
                                      showError(e?.message || 'Failed to generate invoice')
                                    }
                                  },
                                }]),
                            { divider: true },
                            { label: t(`${translationKey}.edit`), icon: EditIcon, onClick: () => handleEdit(transaction, invoicingEnabled) },
                            { label: t(`${translationKey}.delete`), icon: Trash2, danger: true, onClick: () => handleDelete(transaction.transaction_id) }
                          ]}
                        />
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan="12" className="px-2 py-0 align-top">
                          <div
                            ref={(el) => {
                              if (el) paymentDetailsRefs.current.set(transaction.transaction_id, el)
                              else paymentDetailsRefs.current.delete(transaction.transaction_id)
                            }}
                            className="payment-detail-row py-2 pl-2 pr-1 -mr-1 border-l-4 border-blue-200 bg-gradient-to-r from-blue-50/80 to-transparent rounded-r mb-1"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 mb-1.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <h4 className="font-semibold text-gray-800 text-xs flex items-center gap-1">
                                  <span className="w-1.5 h-4 bg-blue-500 rounded"></span>
                                  {t('paymentsBreakdown.payments')}
                                  <span className="ml-1 text-gray-500 font-normal">({transactionPayments.length})</span>
                                </h4>
                                <div className="flex gap-2 text-xs flex-wrap">
                                  {selectedMonth ? (
                                    <>
                                      <span className="text-green-700 font-medium">
                                        {t('dashboard.paid')}: {formatCurrency(paidMapsByTransactionId.inMonth.get(transaction.transaction_id) || 0)}
                                      </span>
                                      {(paidMapsByTransactionId.beforeMonth.get(transaction.transaction_id) || 0) > 0 && (
                                        <span className="text-gray-600 font-medium">
                                          {t('common.previous')}: {formatCurrency(paidMapsByTransactionId.beforeMonth.get(transaction.transaction_id) || 0)}
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    <span className="text-green-700 font-medium">{t('dashboard.paid')}: {formatCurrency(transaction.paid_amount)}</span>
                                  )}
                                  <span className="text-red-600 font-medium">{t('dashboard.remaining')}: {formatCurrency(transaction.remaining_amount)}</span>
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  setPaymentFormData({
                                    transaction_id: transaction.transaction_id,
                                    payment_amount: '',
                                    payment_date: new Date().toISOString().split('T')[0],
                                    payment_method: 'cash',
                                    reference_number: ''
                                  })
                                  setShowPaymentModal(true)
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded shadow shrink-0"
                              >
                                <span>+</span> {t('paymentsBreakdown.addPayment')}
                              </button>
                            </div>
                            {transactionPayments.length > 0 ? (
                              <div className="max-h-64 overflow-y-auto pr-1 space-y-1">
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
                                        <p className="font-semibold text-green-700 text-sm">{formatCurrency(payment.payment_amount)}</p>
                                        <p className="text-gray-500 text-xs">
                                          {new Date(payment.payment_date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                                          {payment.payment_method && payment.payment_method !== 'cash' && (
                                            <span className="ml-1 inline-flex items-center px-1 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-medium">{t('common.paymentMethod_' + payment.payment_method)}</span>
                                          )}
                                          {payment.reference_number && (
                                            <span className="ml-1 text-gray-400">#{payment.reference_number}</span>
                                          )}
                                        </p>
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
                {invoiceModalMode
                  ? (editingTransaction ? t('clientTransactions.editInvoice') : t('clientTransactions.createInvoice'))
                  : (editingTransaction ? t(`${translationKey}.editTransaction`) : t(`${translationKey}.addTransaction`))}
              </h3>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
              <div className="bg-white px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 overflow-y-auto">
                {invoiceModalMode && editingTransaction && isIssuedInvoice(editingTransaction) && (
                  <div className="sm:col-span-2 p-2.5 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900">
                    {t('clientTransactions.invoiceIssuedEditWarning')}
                  </div>
                )}
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
                {!invoiceModalMode && (
                <>
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
                      if (invoiceModalMode) {
                        const { netTotal } = getInvoiceCalc({ unit_price: price })
                        setFormData({
                          ...formData,
                          product_price: price,
                          total_amount: netTotal > 0 ? netTotal.toFixed(2) : formData.total_amount,
                        })
                      } else {
                        setFormData({
                          ...formData,
                          product_price: price,
                          total_amount: price && formData.quantity
                            ? (parseFloat(price) * formData.quantity).toFixed(2)
                            : formData.total_amount,
                        })
                      }
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
                      if (invoiceModalMode) {
                        const { netTotal } = getInvoiceCalc({ quantity, unit_price: price })
                        setFormData({
                          ...formData,
                          quantity,
                          total_amount: netTotal > 0 ? netTotal.toFixed(2) : formData.total_amount,
                        })
                      } else {
                        setFormData({
                          ...formData,
                          quantity,
                          total_amount: price ? (parseFloat(price) * quantity).toFixed(2) : formData.total_amount,
                        })
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                </>
                )}
                {invoiceModalMode && (
                  <div className="sm:col-span-2 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-sm font-semibold text-gray-800">{t('clientTransactions.invoiceLines')}</label>
                      <button
                        type="button"
                        onClick={addExtraInvoiceLine}
                        className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800"
                      >
                        <Plus size={16} />
                        {t('clientTransactions.addLine')}
                      </button>
                    </div>
                    {/* Row 0: primary product line (kept in sync with dedicated columns) */}
                    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                        <div className="sm:col-span-5 relative autocomplete-container">
                          <label className="block text-xs font-medium text-gray-600 mb-1">{t('clientTransactions.lineDescription')} *</label>
                          <input
                            type="text"
                            required
                            value={formData.product_name}
                            onChange={(e) => handleProductInput(e.target.value)}
                            onFocus={() => formData.product_name && handleProductInput(formData.product_name)}
                            placeholder={t('clientTransactions.lineDescriptionPlaceholder')}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
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
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-gray-600 mb-1">{t(`${translationKey}.quantity`)} *</label>
                          <input
                            type="number"
                            required
                            min="1"
                            value={formData.quantity}
                            onChange={(e) => {
                              const quantity = e.target.value
                              const { netTotal } = getInvoiceCalc({ quantity })
                              setFormData({ ...formData, quantity, total_amount: netTotal > 0 ? netTotal.toFixed(2) : formData.total_amount })
                            }}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-gray-600 mb-1">{t(`${translationKey}.unitPrice`)} *</label>
                          <input
                            type="number"
                            required
                            step="0.01"
                            min="0"
                            value={formData.product_price}
                            onChange={(e) => {
                              const price = e.target.value
                              const { netTotal } = getInvoiceCalc({ unit_price: price })
                              setFormData({ ...formData, product_price: price, total_amount: netTotal > 0 ? netTotal.toFixed(2) : formData.total_amount })
                            }}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <label className="block text-xs font-medium text-gray-600 mb-1">{t(`${translationKey}.total`)}</label>
                          <input
                            type="text"
                            readOnly
                            value={calcLineTotal(formData.quantity, formData.product_price).toFixed(2)}
                            className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white text-gray-700"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                        <div className="sm:col-span-4">
                          <label className="block text-xs font-medium text-gray-600 mb-1">{t('clientTransactions.etaCodeName')}</label>
                          <input
                            type="text"
                            value={formData.eta_item_name}
                            onChange={(e) => setFormData({ ...formData, eta_item_name: e.target.value })}
                            placeholder={t('clientTransactions.etaCodeNamePlaceholder')}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                          />
                        </div>
                        <div className="sm:col-span-4">
                          <label className="block text-xs font-medium text-gray-600 mb-1">{t('clientTransactions.etaItemCode')}</label>
                          <EtaCodeInput
                            value={formData.eta_item_code}
                            codes={etaCodes}
                            onChange={(text) => setFormData({ ...formData, eta_item_code: text })}
                            onSelect={(code) => setFormData((f) => ({
                              ...f,
                              eta_item_code: code.item_code,
                              eta_item_name: code.item_name || f.eta_item_name || '',
                              eta_unit_type: code.unit_type || f.eta_unit_type || 'EA',
                            }))}
                            placeholder={t('clientTransactions.etaItemCodePlaceholder')}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                          />
                        </div>
                        <div className="sm:col-span-4">
                          <label className="block text-xs font-medium text-gray-600 mb-1">{t('clientTransactions.etaUnitType')}</label>
                          <input
                            type="text"
                            value={formData.eta_unit_type}
                            onChange={(e) => setFormData({ ...formData, eta_unit_type: e.target.value })}
                            placeholder="EA"
                            list="eta-unit-types-line"
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                          />
                        </div>
                      </div>
                    </div>
                    {/* Additional lines */}
                    {extraInvoiceLines.map((line, index) => (
                      <div key={index} className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                          <div className="sm:col-span-4">
                            <label className="block text-xs font-medium text-gray-600 mb-1">{t('clientTransactions.lineDescription')}</label>
                            <input
                              type="text"
                              value={line.product_name}
                              onChange={(e) => updateExtraLine(index, 'product_name', e.target.value)}
                              placeholder={t('clientTransactions.lineDescriptionPlaceholder')}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-xs font-medium text-gray-600 mb-1">{t(`${translationKey}.quantity`)}</label>
                            <input
                              type="number"
                              min="1"
                              value={line.quantity}
                              onChange={(e) => updateExtraLine(index, 'quantity', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-xs font-medium text-gray-600 mb-1">{t(`${translationKey}.unitPrice`)}</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.unit_price}
                              onChange={(e) => updateExtraLine(index, 'unit_price', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-xs font-medium text-gray-600 mb-1">{t(`${translationKey}.total`)}</label>
                            <input
                              type="text"
                              readOnly
                              value={line.line_total || calcLineTotal(line.quantity, line.unit_price).toFixed(2)}
                              className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white text-gray-700"
                            />
                          </div>
                          <div className="sm:col-span-2 flex justify-end">
                            <button
                              type="button"
                              onClick={() => removeExtraInvoiceLine(index)}
                              className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                              aria-label={t('clientTransactions.removeLine')}
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                          <div className="sm:col-span-4">
                            <label className="block text-xs font-medium text-gray-600 mb-1">{t('clientTransactions.etaCodeName')}</label>
                            <input
                              type="text"
                              value={line.item_name || ''}
                              onChange={(e) => updateExtraLine(index, 'item_name', e.target.value)}
                              placeholder={t('clientTransactions.etaCodeNamePlaceholder')}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            />
                          </div>
                          <div className="sm:col-span-4">
                            <label className="block text-xs font-medium text-gray-600 mb-1">{t('clientTransactions.etaItemCode')}</label>
                            <EtaCodeInput
                              value={line.item_code || ''}
                              codes={etaCodes}
                              onChange={(text) => updateExtraLine(index, 'item_code', text)}
                              onSelect={(code) => {
                                setExtraInvoiceLines((prev) => {
                                  const next = [...prev]
                                  next[index] = {
                                    ...next[index],
                                    item_code: code.item_code,
                                    item_name: code.item_name || next[index].item_name || '',
                                    unit_type: code.unit_type || next[index].unit_type || 'EA',
                                  }
                                  return next
                                })
                              }}
                              placeholder={t('clientTransactions.etaItemCodePlaceholder')}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            />
                          </div>
                          <div className="sm:col-span-4">
                            <label className="block text-xs font-medium text-gray-600 mb-1">{t('clientTransactions.etaUnitType')}</label>
                            <input
                              type="text"
                              value={line.unit_type || ''}
                              onChange={(e) => updateExtraLine(index, 'unit_type', e.target.value)}
                              placeholder="EA"
                              list="eta-unit-types-line"
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                    <datalist id="eta-unit-types-line">
                      <option value="EA" />
                      <option value="KGM" />
                      <option value="GM" />
                      <option value="LTR" />
                      <option value="MTR" />
                      <option value="BX" />
                      <option value="PK" />
                      <option value="SET" />
                    </datalist>
                  </div>
                )}
                {invoiceModalMode && (() => {
                  const calc = getInvoiceCalc()
                  return (
                    <div className="sm:col-span-2 border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
                      <div className="flex items-center justify-between text-sm text-gray-700">
                        <span>{t('clientTransactions.subtotal')}</span>
                        <span className="font-medium">{formatCurrency(calc.subtotal)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Number(formData.vat_rate) > 0}
                            onChange={(e) => handleVatToggle(e.target.checked)}
                            className="rounded border-gray-400 text-blue-600 focus:ring-blue-500"
                          />
                          <span>{t('clientTransactions.applyVat', { rate: VAT_RATE })}</span>
                        </label>
                        <span className="font-medium">{Number(formData.vat_rate) > 0 ? formatCurrency(calc.vatAmount) : formatCurrency(0)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-sm text-gray-700">{t('clientTransactions.withholdingTax')}</label>
                        <select
                          value={formData.wht_rate}
                          onChange={(e) => handleWhtRateChange(e.target.value)}
                          className="px-2 py-1.5 border border-gray-300 rounded text-sm"
                        >
                          {WHT_RATE_OPTIONS.map((rate) => (
                            <option key={rate} value={rate}>
                              {rate === 0 ? t('clientTransactions.whtNone') : `${rate}%`}
                            </option>
                          ))}
                        </select>
                      </div>
                      {calc.whtAmount > 0 && (
                        <div className="flex items-center justify-between text-sm text-red-700">
                          <span>{t('clientTransactions.withholdingDeducted', { rate: calc.whtRate })}</span>
                          <span className="font-medium">- {formatCurrency(calc.whtAmount)}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-base font-bold text-gray-900 border-t border-gray-300 pt-2">
                        <span>{t('clientTransactions.netTotal')}</span>
                        <span>{formatCurrency(calc.netTotal)}</span>
                      </div>
                    </div>
                  )
                })()}
                {!invoiceModalMode && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t(`${translationKey}.totalAmount`)} *</label>
                  <input
                    type="number"
                    required
                    step="0.01"
                    min="0"
                    value={formData.total_amount}
                    onChange={(e) => setFormData({ ...formData, total_amount: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t(`${translationKey}.paidAmount`)}</label>
                  <input type="number" step="0.01" min="0" value={formData.paid_amount} onChange={(e) => setFormData({ ...formData, paid_amount: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t(`${translationKey}.transactionDate`)} *</label>
                  <input type="date" required value={formData.transaction_date} onChange={(e) => {
                    const newDate = e.target.value
                    const autodue = formData.payment_terms !== 'none' && !formData.due_date ? calcDueDate(newDate, formData.payment_terms) : formData.due_date
                    setFormData({ ...formData, transaction_date: newDate, due_date: autodue })
                  }}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.invoiceNumber')}</label>
                  {invoiceModalMode ? (
                    formData.invoice_number ? (
                      <input
                        type="text"
                        readOnly
                        value={formData.invoice_number}
                        className="w-full px-3 py-2 border border-gray-200 rounded text-sm bg-gray-100 text-gray-800"
                      />
                    ) : (
                      <p className="text-sm text-gray-600 px-1 py-2">
                        {t('clientTransactions.invoiceAutoNumberHint')}:{' '}
                        <span className="font-semibold text-gray-900">{peekNextInvoiceNumber()}</span>
                      </p>
                    )
                  ) : (
                    <input
                      type="text"
                      value={formData.invoice_number}
                      onChange={(e) => setFormData({ ...formData, invoice_number: e.target.value })}
                      placeholder={t('common.invoiceNumberPlaceholder')}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.paymentTerms')}</label>
                  <select value={formData.payment_terms} onChange={(e) => {
                    const terms = e.target.value
                    const autodue = calcDueDate(formData.transaction_date, terms)
                    setFormData({ ...formData, payment_terms: terms, due_date: autodue })
                  }}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {PAYMENT_TERMS_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.dueDate')}</label>
                  <input type="date" value={formData.due_date} onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                {!invoiceModalMode && (
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
                )}
              </div>
              <div className="bg-gray-50 px-4 py-2 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 flex-shrink-0 border-t">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setInvoiceModalMode(false) }}
                  className="px-4 py-2 border border-gray-300 rounded text-gray-700 text-sm font-medium hover:bg-gray-100"
                >
                  {t(`${translationKey}.cancel`)}
                </button>
                {invoiceModalMode ? (
                  <>
                    {(!editingTransaction || isDraftInvoice(editingTransaction)) && (
                      <button
                        type="submit"
                        data-save-mode="draft"
                        disabled={submitting}
                        className="px-4 py-2 border border-blue-300 bg-white text-blue-700 text-sm font-medium rounded hover:bg-blue-50 disabled:opacity-50"
                      >
                        {t('clientTransactions.saveAsDraft')}
                      </button>
                    )}
                    {(!editingTransaction || isDraftInvoice(editingTransaction)) && (
                      <button
                        type="submit"
                        data-save-mode="issue"
                        disabled={submitting}
                        className={`px-4 py-2 bg-${primaryColor}-600 text-white text-sm font-medium rounded hover:bg-${primaryColor}-700 disabled:opacity-50 flex items-center justify-center gap-2`}
                      >
                        {submitting ? <><LoadingSpinner size="sm" /><span>{t(`${translationKey}.saving`)}</span></> : <span>{t('clientTransactions.issueAndPrint')}</span>}
                      </button>
                    )}
                    {editingTransaction && isIssuedInvoice(editingTransaction) && (
                      <button
                        type="submit"
                        data-save-mode="save"
                        disabled={submitting}
                        className={`px-4 py-2 bg-${primaryColor}-600 text-white text-sm font-medium rounded hover:bg-${primaryColor}-700 disabled:opacity-50 flex items-center justify-center gap-2`}
                      >
                        {submitting ? <><LoadingSpinner size="sm" /><span>{t(`${translationKey}.saving`)}</span></> : <span>{t(`${translationKey}.updateTransaction`)}</span>}
                      </button>
                    )}
                  </>
                ) : (
                  <button type="submit" data-save-mode="save" disabled={submitting} className={`px-4 py-2 bg-${primaryColor}-600 text-white text-sm font-medium rounded hover:bg-${primaryColor}-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}>
                    {submitting ? <><LoadingSpinner size="sm" /><span>{t(`${translationKey}.saving`)}</span></> : <span>{editingTransaction ? t(`${translationKey}.updateTransaction`) : t(`${translationKey}.createTransaction`)}</span>}
                  </button>
                )}
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
              <div ref={paymentModalContentRef} className="bg-white px-4 py-3 space-y-3 overflow-y-auto">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('paymentsBreakdown.paymentAmount')} *</label>
                  <input ref={paymentAmountInputRef} type="number" required step="0.01" min="0.01" value={paymentFormData.payment_amount} onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_amount: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500" placeholder="0.00" />
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
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.paymentMethod')}</label>
                  <select value={paymentFormData.payment_method} onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_method: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  >
                    {PAYMENT_METHOD_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.referenceNumber')}</label>
                  <input type="text" value={paymentFormData.reference_number} onChange={(e) => setPaymentFormData({ ...paymentFormData, reference_number: e.target.value })}
                    placeholder={t('common.referenceNumberPlaceholder')}
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

      {statementModalData && (
        <ClientStatementModal
          isOpen={showStatementModal}
          onClose={() => {
            setShowStatementModal(false)
            setStatementModalData(null)
          }}
          client={statementModalData.client}
          transactions={statementModalData.transactions}
          payments={statementModalData.payments}
          initialDateFrom={statementModalData.dateFrom}
          initialDateTo={statementModalData.dateTo}
        />
      )}

      {invoicePreview && (
        <InvoiceModal
          isOpen={!!invoicePreview}
          onClose={() => setInvoicePreview(null)}
          transaction={invoicePreview.transaction}
          payments={invoicePreview.payments}
        />
      )}
    </>
  )
}

export default TransactionPage
