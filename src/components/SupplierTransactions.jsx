import { useState, useEffect, useMemo } from 'react'
import React from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { useLanguage } from '../context/LanguageContext'
import LoadingSpinner from './LoadingSpinner'
import TableSkeleton from './TableSkeleton'
import Pagination from './ui/Pagination'
import { downloadCsv } from '../utils/exportCsv'

function SupplierTransactions() {
  const [transactions, setTransactions] = useState([])
  const [suppliers, setSuppliers] = useState([])
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
  const [filterSupplierId, setFilterSupplierId] = useState('')
  const [filterProductId, setFilterProductId] = useState('')
  const [filterPaymentStatus, setFilterPaymentStatus] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [formData, setFormData] = useState({
    supplier_id: '',
    supplier_name: '',
    product_id: '',
    product_name: '',
    product_price: '',
    quantity: '',
    total_amount: '',
    paid_amount: '0',
    transaction_date: new Date().toISOString().split('T')[0]
  })
  const [supplierSuggestions, setSupplierSuggestions] = useState([])
  const [productSuggestions, setProductSuggestions] = useState([])
  const [showSupplierSuggestions, setShowSupplierSuggestions] = useState(false)
  const [showProductSuggestions, setShowProductSuggestions] = useState(false)
  const [paymentFormData, setPaymentFormData] = useState({
    transaction_id: '',
    payment_amount: '',
    payment_date: new Date().toISOString().split('T')[0]
  })
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(5)
  const { success, error: showError } = useToast()
  const { t } = useLanguage()

  useEffect(() => {
    fetchData()
    subscribeToChanges()
  }, [])

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.autocomplete-container')) {
        setShowSupplierSuggestions(false)
        setShowProductSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      
      const [suppliersResult, productsResult, transactionsResult, paymentsResult] = await Promise.all([
        supabase.from('suppliers').select('*').order('supplier_name'),
        supabase.from('products').select('*').order('product_name'),
        supabase
          .from('supplier_transactions')
          .select(`
            *,
            suppliers:supplier_id (
              supplier_name,
              contact_info
            ),
            products:product_id (
              product_name,
              model,
              unit_price
            )
          `)
          .order('transaction_date', { ascending: false }),
        supabase.from('payments').select('*').eq('transaction_type', 'supplier').order('payment_date', { ascending: false })
      ])
      
      if (suppliersResult.error) throw suppliersResult.error
      if (productsResult.error) throw productsResult.error
      if (transactionsResult.error) throw transactionsResult.error
      if (paymentsResult.error) throw paymentsResult.error
      
      setSuppliers(suppliersResult.data || [])
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

  const subscribeToChanges = () => {
    const channel1 = supabase
      .channel('supplier_transactions_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'supplier_transactions'
        },
        () => {
          fetchData()
        }
      )
      .subscribe()

    const channel2 = supabase
      .channel('payments_changes_supplier')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'payments'
        },
        () => {
          fetchData()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel1)
      supabase.removeChannel(channel2)
    }
  }

  const handleSupplierInput = (value) => {
    setFormData({ ...formData, supplier_name: value, supplier_id: '' })
    if (value.length > 0) {
      const filtered = suppliers.filter(s => 
        s.supplier_name.toLowerCase().includes(value.toLowerCase())
      )
      setSupplierSuggestions(filtered)
      setShowSupplierSuggestions(true)
    } else {
      setSupplierSuggestions([])
      setShowSupplierSuggestions(false)
    }
  }

  const handleSupplierSelect = (supplier) => {
    setFormData({ ...formData, supplier_id: supplier.supplier_id, supplier_name: supplier.supplier_name })
    setShowSupplierSuggestions(false)
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
      // Handle supplier - create if doesn't exist
      let supplierId = formData.supplier_id
      if (!supplierId && formData.supplier_name) {
        // Check if supplier exists
        const { data: existingSupplier } = await supabase
          .from('suppliers')
          .select('supplier_id')
          .eq('supplier_name', formData.supplier_name.trim())
          .single()
        
        if (existingSupplier) {
          supplierId = existingSupplier.supplier_id
        } else {
          // Create new supplier
          const { data: newSupplier, error: supplierError } = await supabase
            .from('suppliers')
            .insert([{ supplier_name: formData.supplier_name.trim() }])
            .select()
            .single()
          
          if (supplierError) throw supplierError
          supplierId = newSupplier.supplier_id
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
        supplier_id: parseInt(supplierId),
        product_id: parseInt(productId),
        quantity: parseInt(formData.quantity),
        unit_price: unitPrice,
        total_amount: parseFloat(formData.total_amount),
        paid_amount: parseFloat(formData.paid_amount) || 0,
        remaining_amount: parseFloat(formData.total_amount) - (parseFloat(formData.paid_amount) || 0),
        transaction_date: formData.transaction_date
      }

      if (editingTransaction) {
        const transactionId = editingTransaction.transaction_id
        const newPaidAmount = parseFloat(formData.paid_amount) || 0
        
        // Update the transaction
        const { error } = await supabase
          .from('supplier_transactions')
          .update(transactionData)
          .eq('transaction_id', transactionId)
        
        if (error) throw error
        
        // Sync paid_amount with payments table
        // Get current payments total
        const { data: existingPayments } = await supabase
          .from('payments')
          .select('payment_amount')
          .eq('transaction_id', transactionId)
          .eq('transaction_type', 'supplier')
        
        const currentPaymentsTotal = existingPayments?.reduce((sum, p) => sum + parseFloat(p.payment_amount || 0), 0) || 0
        
        // If new paid_amount > current payments total, add a payment for the difference
        if (newPaidAmount > currentPaymentsTotal) {
          const difference = newPaidAmount - currentPaymentsTotal
          const { error: paymentError } = await supabase
            .from('payments')
            .insert([{
              transaction_id: transactionId,
              transaction_type: 'supplier',
              payment_amount: difference,
              payment_date: formData.transaction_date
            }])
          
          if (paymentError) {
            console.error('Error syncing payment:', paymentError)
          }
        }
        // If new paid_amount < current payments total, we keep existing payments
        // (can't remove specific payments automatically)
        
        success(t('supplierTransactions.transactionUpdated'))
      } else {
        // Insert the transaction and get the transaction_id
        const { data: newTransaction, error } = await supabase
          .from('supplier_transactions')
          .insert([transactionData])
          .select()
          .single()
        
        if (error) throw error
        
        // If paid_amount > 0, create a payment record
        const paidAmount = parseFloat(formData.paid_amount) || 0
        if (paidAmount > 0 && newTransaction) {
          const { error: paymentError } = await supabase
            .from('payments')
            .insert([{
              transaction_id: newTransaction.transaction_id,
              transaction_type: 'supplier',
              payment_amount: paidAmount,
              payment_date: formData.transaction_date
            }])
          
          if (paymentError) {
            console.error('Error creating initial payment:', paymentError)
            // Don't throw - transaction was created successfully, payment is secondary
          }
        }
        
        success(t('supplierTransactions.transactionCreated'))
      }

      setShowModal(false)
      setEditingTransaction(null)
      setFormData({
        supplier_id: '',
        supplier_name: '',
        product_id: '',
        product_name: '',
        product_price: '',
        quantity: '',
        total_amount: '',
        paid_amount: '0',
        transaction_date: new Date().toISOString().split('T')[0]
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
    setFormData({
      supplier_id: transaction.supplier_id ? transaction.supplier_id.toString() : '',
      supplier_name: transaction.suppliers?.supplier_name || '',
      product_id: transaction.product_id ? transaction.product_id.toString() : '',
      product_name: transaction.products?.product_name || '',
      product_price: (transaction.unit_price !== undefined && transaction.unit_price !== null)
        ? transaction.unit_price.toString()
        : (transaction.products?.unit_price !== undefined && transaction.products?.unit_price !== null ? transaction.products.unit_price.toString() : (transaction.quantity ? (parseFloat(transaction.total_amount) / transaction.quantity).toFixed(2) : '')),
      quantity: transaction.quantity.toString(),
      total_amount: transaction.total_amount.toString(),
      paid_amount: transaction.paid_amount.toString(),
      transaction_date: transaction.transaction_date
    })
    setShowModal(true)
  }

  const handleDelete = async (transactionId) => {
    if (!window.confirm(t('supplierTransactions.deleteConfirm'))) return

    try {
      // First, delete all payments associated with this transaction
      const { error: paymentsError } = await supabase
        .from('payments')
        .delete()
        .eq('transaction_id', transactionId)
        .eq('transaction_type', 'supplier')
      
      if (paymentsError) throw paymentsError
      
      // Then delete the transaction
      const { error } = await supabase
        .from('supplier_transactions')
        .delete()
        .eq('transaction_id', transactionId)
      
      if (error) throw error
      success(t('supplierTransactions.transactionDeleted'))
      await fetchData()
    } catch (err) {
      console.error('Error deleting transaction:', err)
      showError('Error deleting transaction: ' + err.message)
    }
  }

  const getPaymentsForTransaction = (transactionId) => {
    // Only return payments for supplier transactions
    const supplierTransactionIds = transactions.map(t => t.transaction_id)
    return payments.filter(p => 
      p.transaction_id === transactionId && 
      supplierTransactionIds.includes(p.transaction_id)
    )
  }

  const handleAddPayment = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    
    try {
      const transactionId = parseInt(paymentFormData.transaction_id)
      
      // First, verify the transaction exists in supplier_transactions
      const { data: transaction, error: fetchError } = await supabase
        .from('supplier_transactions')
        .select('*')
        .eq('transaction_id', transactionId)
        .single()

      if (fetchError || !transaction) {
        throw new Error(`Transaction not found in supplier transactions. Please ensure this is a supplier transaction.`)
      }

      // Check if transaction exists in client_transactions (should not)
      const { data: clientCheck } = await supabase
        .from('client_transactions')
        .select('transaction_id')
        .eq('transaction_id', transactionId)
        .single()

      if (clientCheck) {
        throw new Error('This transaction ID exists in client transactions. Cannot add payment to supplier transaction.')
      }

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

      // Insert the payment with transaction_type
      const { data: paymentData, error: paymentError } = await supabase
        .from('payments')
        .insert([{
          transaction_id: transactionId,
          transaction_type: 'supplier',
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

      // Update the transaction with new paid/remaining amounts
      const { error: updateError } = await supabase
        .from('supplier_transactions')
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
        .from('supplier_transactions')
        .select('*')
        .eq('transaction_id', transactionId)
        .single()

      const newPaidAmount = Math.max(0, parseFloat(transaction.paid_amount || 0) - parseFloat(payment.payment_amount))
      const newRemainingAmount = parseFloat(transaction.total_amount) - newPaidAmount

      await supabase
        .from('supplier_transactions')
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

    if (filterSupplierId) {
      result = result.filter(t => t.supplier_id === parseInt(filterSupplierId))
    }

    if (filterProductId) {
      result = result.filter(t => t.product_id === parseInt(filterProductId))
    }

    if (filterPaymentStatus === 'outstanding') {
      result = result.filter(t => parseFloat(t.remaining_amount || 0) > 0)
    } else if (filterPaymentStatus === 'paid') {
      result = result.filter(t => parseFloat(t.remaining_amount || 0) === 0)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      result = result.filter(t => {
        const supplierName = (t.suppliers?.supplier_name || '').toLowerCase()
        const productName = (t.products?.product_name || '').toLowerCase()
        const model = (t.products?.model || '').toLowerCase()
        return supplierName.includes(q) || productName.includes(q) || model.includes(q)
      })
    }

    return result
  }

  const hasActiveFilters = filterSupplierId || filterProductId || filterPaymentStatus !== 'all' || searchQuery.trim()
  const clearFilters = () => {
    setFilterSupplierId('')
    setFilterProductId('')
    setFilterPaymentStatus('all')
    setSearchQuery('')
  }

  const filteredTransactions = getFilteredTransactions()

  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / pageSize))
  const paginatedTransactions = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredTransactions.slice(start, start + pageSize)
  }, [filteredTransactions, currentPage, pageSize])

  useEffect(() => {
    setCurrentPage(1)
  }, [filterSupplierId, filterProductId, filterPaymentStatus, searchQuery, selectedMonth, includePastRemaining])

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

    const rows = filteredTransactions.map((tx) => ({
      [t('supplierTransactions.date')]: tx.transaction_date,
      [t('supplierTransactions.supplier')]: tx.suppliers?.supplier_name || '',
      [t('supplierTransactions.product')]: tx.products?.product_name || '',
      [t('supplierTransactions.quantity')]: tx.quantity,
      [t('supplierTransactions.unitPrice')]: tx.unit_price ?? (tx.quantity ? parseFloat(tx.total_amount) / tx.quantity : ''),
      [t('supplierTransactions.totalAmount')]: tx.total_amount,
      [t('supplierTransactions.paidAmount')]: tx.paid_amount,
      [t('supplierTransactions.remainingAmount')]: tx.remaining_amount
    }))

    downloadCsv('supplier-transactions.csv', rows)
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
    return filteredTransactions
      .filter(t => {
        if (!selectedMonth) return true
        const [year, month] = selectedMonth.split('-')
        const transactionDate = new Date(t.transaction_date)
        const selectedDate = new Date(parseInt(year), parseInt(month) - 1, 1)
        const nextMonth = new Date(parseInt(year), parseInt(month), 1)
        return transactionDate >= selectedDate && transactionDate < nextMonth
      })
      .reduce((sum, t) => sum + parseFloat(t.paid_amount || 0), 0)
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

  const resetForm = () => {
    setEditingTransaction(null)
    setFormData({
      supplier_id: '',
      supplier_name: '',
      product_id: '',
      product_name: '',
      product_price: '',
      quantity: '',
      total_amount: '',
      paid_amount: '0',
      transaction_date: new Date().toISOString().split('T')[0]
    })
    setSupplierSuggestions([])
    setProductSuggestions([])
    setShowSupplierSuggestions(false)
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
    <div className="h-full flex flex-col overflow-hidden min-h-0">
      <div className="flex-shrink-0 space-y-2">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{t('supplierTransactions.title')}</h2>
            <p className="text-gray-600 text-sm">{t('supplierTransactions.subtitle')}</p>
          </div>
          <div className="flex gap-1.5">
            <button type="button" onClick={handleExportCsv} className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-1.5 px-3 rounded text-sm">{t('common.exportCsv')}</button>
            <button onClick={() => { resetForm(); setShowModal(true) }} className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 px-4 rounded text-sm">{t('supplierTransactions.addTransaction')}</button>
          </div>
        </div>

        <div className="bg-white p-2 rounded-lg shadow border border-gray-200">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 border-r border-gray-200 pr-2">
              <button onClick={() => { if (selectedMonth) { const [y,m] = selectedMonth.split('-'); const d = new Date(parseInt(y), parseInt(m)-2,1); setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`) } }} className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-sm" title="Previous month">‹</button>
              <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="px-1.5 py-0.5 border border-gray-300 rounded text-xs w-[110px]" />
              <button onClick={() => { if (selectedMonth) { const [y,m] = selectedMonth.split('-'); const d = new Date(parseInt(y), parseInt(m),1); setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`) } }} className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-sm" title="Next month">›</button>
              <button onClick={() => { const n = new Date(); setSelectedMonth(`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`) }} className="px-1.5 py-0.5 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded text-xs">{t('supplierTransactions.currentMonth')}</button>
              <button onClick={() => setSelectedMonth('')} className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded text-xs">{t('supplierTransactions.allMonths')}</button>
            </div>
            <input type="text" placeholder={t('common.searchPlaceholder')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="px-1.5 py-0.5 border border-gray-300 rounded text-xs w-[100px]" />
            <select value={filterSupplierId} onChange={(e) => setFilterSupplierId(e.target.value)} className="px-1.5 py-0.5 border border-gray-300 rounded text-xs">
              <option value="">{t('common.filterBySupplier')}</option>
              {suppliers.map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}</option>)}
            </select>
            <select value={filterProductId} onChange={(e) => setFilterProductId(e.target.value)} className="px-1.5 py-0.5 border border-gray-300 rounded text-xs">
              <option value="">{t('common.filterByProduct')}</option>
              {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.product_name}{p.model ? ` (${p.model})` : ''}</option>)}
            </select>
            <select value={filterPaymentStatus} onChange={(e) => setFilterPaymentStatus(e.target.value)} className="px-1.5 py-0.5 border border-gray-300 rounded text-xs">
              <option value="all">{t('common.paymentStatus')}</option>
              <option value="outstanding">{t('common.outstanding')}</option>
              <option value="paid">{t('common.paidInFull')}</option>
            </select>
            {hasActiveFilters && <button type="button" onClick={clearFilters} className="px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 rounded">{t('common.clearFilters')}</button>}
            {selectedMonth && <label className="flex items-center gap-1 ml-auto text-xs text-gray-600 cursor-pointer"><input type="checkbox" checked={includePastRemaining} onChange={(e) => setIncludePastRemaining(e.target.checked)} className="w-3 h-3 text-purple-600 border-gray-300 rounded" /><span>Include past</span></label>}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="bg-purple-600 text-white p-2.5 rounded shadow"><p className="text-xs font-medium">{t('supplierTransactions.totalAmount')}</p><p className="text-lg font-bold">${calculateTotal().toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div>
          <div className="bg-green-600 text-white p-2.5 rounded shadow"><p className="text-xs font-medium">{t('supplierTransactions.paidAmount')}</p><p className="text-lg font-bold">${calculatePaid().toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div>
          <div className="bg-red-600 text-white p-2.5 rounded shadow"><p className="text-xs font-medium">{t('supplierTransactions.remainingAmount')}</p><p className="text-lg font-bold">${calculateRemaining().toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div>
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-white shadow rounded overflow-hidden flex flex-col mt-2">
        <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
          <table className="min-w-full divide-y divide-gray-200 table-fixed text-sm">
            <thead className="bg-gray-100 sticky top-0">
              <tr>
                <th className="px-2 py-1.5 text-left text-xs font-semibold text-gray-700 uppercase w-20">{t('supplierTransactions.date')}</th>
                <th className="px-2 py-1.5 text-left text-xs font-semibold text-gray-700 uppercase w-[14%] min-w-0">{t('supplierTransactions.supplier')}</th>
                <th className="px-2 py-1.5 text-left text-xs font-semibold text-gray-700 uppercase w-[14%] min-w-0">{t('supplierTransactions.product')}</th>
                <th className="px-2 py-1.5 text-left text-xs font-semibold text-gray-700 uppercase w-14">{t('supplierTransactions.quantity')}</th>
                <th className="px-2 py-1.5 text-left text-xs font-semibold text-gray-700 uppercase w-20">{t('supplierTransactions.unitPrice')}</th>
                <th className="px-2 py-1.5 text-left text-xs font-semibold text-gray-700 uppercase w-20">{t('supplierTransactions.total')}</th>
                <th className="px-2 py-1.5 text-left text-xs font-semibold text-gray-700 uppercase w-20">{t('supplierTransactions.paid')}</th>
                <th className="px-2 py-1.5 text-left text-xs font-semibold text-gray-700 uppercase w-20">{t('supplierTransactions.remaining')}</th>
                <th className="px-2 py-1.5 text-left text-xs font-semibold text-gray-700 uppercase w-32">{t('supplierTransactions.actions')}</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-2 py-4 text-center text-gray-500 text-sm">
                    {t('supplierTransactions.noTransactions')}
                  </td>
                </tr>
              ) : (
                paginatedTransactions.map((transaction) => {
                const transactionPayments = getPaymentsForTransaction(transaction.transaction_id)
                const isExpanded = expandedRows.has(transaction.transaction_id)
                return (
                  <React.Fragment key={transaction.transaction_id}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-2 py-1.5 whitespace-nowrap text-sm text-gray-900">{new Date(transaction.transaction_date).toLocaleDateString()}</td>
                      <td className="table-cell-wrap px-2 py-1.5 font-medium text-sm" title={transaction.suppliers?.supplier_name || 'N/A'}>{transaction.suppliers?.supplier_name || 'N/A'}</td>
                      <td className="table-cell-wrap px-2 py-1.5 text-sm" title={`${transaction.products?.product_name || 'N/A'}${transaction.products?.model ? ` (${transaction.products.model})` : ''}`}>{transaction.products?.product_name || 'N/A'}{transaction.products?.model && <span className="text-gray-500 text-xs ml-0.5">({transaction.products.model})</span>}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-sm text-gray-900">{transaction.quantity}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-sm text-gray-900">${(transaction.unit_price ?? (transaction.quantity ? parseFloat(transaction.total_amount) / transaction.quantity : 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-sm font-semibold text-gray-900">${parseFloat(transaction.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-sm font-medium text-green-700">${parseFloat(transaction.paid_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-sm font-medium text-red-700">${parseFloat(transaction.remaining_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="px-2 py-1 text-xs min-w-0">
                        <div className="flex items-center gap-1">
                          <button onClick={() => toggleRowExpansion(transaction.transaction_id)} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${isExpanded ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-700 hover:bg-purple-200'}`}>{t('paymentsBreakdown.payments')} <span className={isExpanded ? 'bg-white/30 px-1 rounded text-[10px]' : 'bg-purple-200 px-1 rounded text-[10px]'}>{transactionPayments.length}</span></button>
                          <button onClick={() => handleEdit(transaction)} className="px-1.5 py-0.5 text-purple-600 hover:bg-purple-50 rounded text-xs">{t('supplierTransactions.edit')}</button>
                          <button onClick={() => handleDelete(transaction.transaction_id)} className="px-1.5 py-0.5 text-red-600 hover:bg-red-50 rounded text-xs">{t('supplierTransactions.delete')}</button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan="9" className="px-2 py-0 align-top">
                          <div className="payment-detail-row py-2 pl-2 pr-1 -mr-1 border-l-4 border-purple-200 bg-gradient-to-r from-purple-50/80 to-transparent rounded-r mb-1">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 mb-1.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <h4 className="font-semibold text-gray-800 text-xs flex items-center gap-1">
                                  <span className="w-1.5 h-4 bg-purple-500 rounded"></span>
                                  {t('paymentsBreakdown.payments')}
                                </h4>
                                <div className="flex gap-2 text-xs">
                                  <span className="text-green-700 font-medium">{t('dashboard.paid')}: ${parseFloat(transaction.paid_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                                  <span className="text-red-600 font-medium">{t('dashboard.remaining')}: ${parseFloat(transaction.remaining_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
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
                                className="inline-flex items-center gap-1 px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded shadow shrink-0"
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
                                        <p className="font-semibold text-green-700 text-sm">${parseFloat(payment.payment_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
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
                                {t('paymentsBreakdown.noSupplierPayments')}
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
              <p className="text-gray-500 text-sm font-medium">{t('supplierTransactions.noTransactions')}</p>
              <p className="text-gray-400 text-xs mt-1">{t('supplierTransactions.noTransactionsDesc')}</p>
            </div>
          )}
        </div>
        {filteredTransactions.length > 0 && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            pageSize={pageSize}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setCurrentPage(1)
            }}
            totalItems={filteredTransactions.length}
          />
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed z-50 inset-0 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div 
              className="fixed inset-0 bg-gray-900 bg-opacity-75" 
              onClick={() => setShowModal(false)}
            ></div>
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-purple-600 px-6 py-4">
                <h3 className="text-xl font-bold text-white">
                  {editingTransaction ? t('supplierTransactions.editTransaction') : t('supplierTransactions.addTransaction')}
                </h3>
              </div>
              <form onSubmit={handleSubmit}>
                <div className="bg-white px-6 pt-6 pb-4 space-y-4">
                  <div className="relative autocomplete-container">
                    <label className="block text-base font-semibold text-gray-700 mb-2">{t('supplierTransactions.supplier')} *</label>
                    <input
                      type="text"
                      required
                      value={formData.supplier_name}
                      onChange={(e) => handleSupplierInput(e.target.value)}
                      onFocus={() => formData.supplier_name && handleSupplierInput(formData.supplier_name)}
                      placeholder={t('supplierTransactions.selectSupplier')}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded text-base focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                    {showSupplierSuggestions && supplierSuggestions.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border-2 border-gray-300 rounded shadow-lg max-h-60 overflow-auto">
                        {supplierSuggestions.map((supplier) => (
                          <div
                            key={supplier.supplier_id}
                            onClick={() => handleSupplierSelect(supplier)}
                            className="px-4 py-2 hover:bg-purple-50 cursor-pointer text-base"
                          >
                            {supplier.supplier_name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="relative autocomplete-container">
                    <label className="block text-base font-semibold text-gray-700 mb-2">{t('supplierTransactions.product')} *</label>
                    <input
                      type="text"
                      required
                      value={formData.product_name}
                      onChange={(e) => handleProductInput(e.target.value)}
                      onFocus={() => formData.product_name && handleProductInput(formData.product_name)}
                      placeholder={t('supplierTransactions.selectProduct')}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded text-base focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                    {showProductSuggestions && productSuggestions.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border-2 border-gray-300 rounded shadow-lg max-h-60 overflow-auto">
                        {productSuggestions.map((product) => (
                          <div
                            key={product.product_id}
                            onClick={() => handleProductSelect(product)}
                            className="px-4 py-2 hover:bg-purple-50 cursor-pointer text-base"
                          >
                            {product.product_name} - ${product.unit_price}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-base font-semibold text-gray-700 mb-2">{t('supplierTransactions.unitPrice')} *</label>
                    <input
                      type="number"
                      required
                      step="0.01"
                      min="0"
                      value={formData.product_price}
                      onChange={(e) => {
                        const price = e.target.value
                        setFormData({ 
                          ...formData, 
                          product_price: price,
                          total_amount: price && formData.quantity ? (parseFloat(price) * formData.quantity).toFixed(2) : formData.total_amount
                        })
                      }}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded text-base focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-base font-semibold text-gray-700 mb-2">{t('supplierTransactions.quantity')} *</label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={formData.quantity}
                      onChange={(e) => {
                        const quantity = e.target.value
                        const price = formData.product_price || (formData.product_id ? products.find(p => p.product_id === parseInt(formData.product_id))?.unit_price : 0)
                        setFormData({ 
                          ...formData, 
                          quantity,
                          total_amount: price ? (parseFloat(price) * quantity).toFixed(2) : formData.total_amount
                        })
                      }}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded text-base focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-base font-semibold text-gray-700 mb-2">{t('supplierTransactions.totalAmount')} *</label>
                    <input
                      type="number"
                      required
                      step="0.01"
                      min="0"
                      value={formData.total_amount}
                      onChange={(e) => setFormData({ ...formData, total_amount: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded text-base focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-base font-semibold text-gray-700 mb-2">{t('supplierTransactions.paidAmount')}</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.paid_amount}
                      onChange={(e) => setFormData({ ...formData, paid_amount: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded text-base focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-base font-semibold text-gray-700 mb-2">{t('supplierTransactions.transactionDate')} *</label>
                    <input
                      type="date"
                      required
                      value={formData.transaction_date}
                      onChange={(e) => setFormData({ ...formData, transaction_date: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded text-base focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                  </div>
                </div>
                <div className="bg-gray-50 px-6 py-4 flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-3 space-y-2 space-y-reverse sm:space-y-0">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="w-full sm:w-auto px-6 py-3 border-2 border-gray-300 rounded text-gray-700 font-semibold hover:bg-gray-100 text-base"
                  >
                    {t('supplierTransactions.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full sm:w-auto px-6 py-3 bg-purple-600 text-white font-semibold rounded hover:bg-purple-700 shadow-md disabled:opacity-50 disabled:cursor-not-allowed text-base flex items-center justify-center space-x-2"
                  >
                    {submitting ? (
                      <>
                        <LoadingSpinner size="sm" />
                        <span>{t('supplierTransactions.saving')}</span>
                      </>
                    ) : (
                      <span>{editingTransaction ? t('supplierTransactions.updateTransaction') : t('supplierTransactions.createTransaction')}</span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed z-50 inset-0 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div 
              className="fixed inset-0 bg-gray-900 bg-opacity-75" 
              onClick={() => setShowPaymentModal(false)}
            ></div>
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-green-600 px-6 py-4">
                <h3 className="text-xl font-bold text-white">{t('paymentsBreakdown.addPayment')}</h3>
              </div>
              <form onSubmit={handleAddPayment}>
                <div className="bg-white px-6 pt-6 pb-4 space-y-4">
                  <div>
                    <label className="block text-base font-semibold text-gray-700 mb-2">{t('paymentsBreakdown.paymentAmount')} *</label>
                    <input
                      type="number"
                      required
                      step="0.01"
                      min="0.01"
                      value={paymentFormData.payment_amount}
                      onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_amount: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded text-base focus:ring-2 focus:ring-green-500 focus:border-green-500"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="block text-base font-semibold text-gray-700 mb-2">{t('paymentsBreakdown.paymentDate')} *</label>
                    <input
                      type="date"
                      required
                      value={paymentFormData.payment_date}
                      onChange={(e) => setPaymentFormData({ ...paymentFormData, payment_date: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded text-base focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    />
                  </div>
                </div>
                <div className="bg-gray-50 px-6 py-4 flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-3 space-y-2 space-y-reverse sm:space-y-0">
                  <button
                    type="button"
                    onClick={() => setShowPaymentModal(false)}
                    className="w-full sm:w-auto px-6 py-3 border-2 border-gray-300 rounded text-gray-700 font-semibold hover:bg-gray-100 text-base"
                  >
                    {t('supplierTransactions.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full sm:w-auto px-6 py-3 bg-green-600 text-white font-semibold rounded hover:bg-green-700 shadow-md disabled:opacity-50 disabled:cursor-not-allowed text-base flex items-center justify-center space-x-2"
                  >
                    {submitting ? (
                      <>
                        <LoadingSpinner size="sm" />
                        <span>{t('paymentsBreakdown.adding')}</span>
                      </>
                    ) : (
                      <span>{t('paymentsBreakdown.addPayment')}</span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SupplierTransactions
