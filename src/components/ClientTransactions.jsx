import { useState, useEffect, useMemo } from 'react'
import React from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { useLanguage } from '../context/LanguageContext'
import LoadingSpinner from './LoadingSpinner'
import TableSkeleton from './TableSkeleton'
import Pagination from './ui/Pagination'
import { downloadCsv } from '../utils/exportCsv'

function ClientTransactions() {
  const [transactions, setTransactions] = useState([])
  const [clients, setClients] = useState([])
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
  const [filterClientId, setFilterClientId] = useState('')
  const [filterProductId, setFilterProductId] = useState('')
  const [filterPaymentStatus, setFilterPaymentStatus] = useState('all') // all, outstanding, paid
  const [searchQuery, setSearchQuery] = useState('')
  const [formData, setFormData] = useState({
    client_id: '',
    client_name: '',
    product_id: '',
    product_name: '',
    product_price: '',
    quantity: '',
    total_amount: '',
    paid_amount: '0',
    transaction_date: new Date().toISOString().split('T')[0]
  })
  const [clientSuggestions, setClientSuggestions] = useState([])
  const [productSuggestions, setProductSuggestions] = useState([])
  const [showClientSuggestions, setShowClientSuggestions] = useState(false)
  const [showProductSuggestions, setShowProductSuggestions] = useState(false)
  const [paymentFormData, setPaymentFormData] = useState({
    transaction_id: '',
    payment_amount: '',
    payment_date: new Date().toISOString().split('T')[0]
  })
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const { success, error: showError } = useToast()
  const { t } = useLanguage()

  useEffect(() => {
    fetchData()
    subscribeToChanges()
  }, [])

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.autocomplete-container')) {
        setShowClientSuggestions(false)
        setShowProductSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      
      const [clientsResult, productsResult, transactionsResult, paymentsResult] = await Promise.all([
        supabase.from('clients').select('*').order('client_name'),
        supabase.from('products').select('*').order('product_name'),
        supabase
          .from('client_transactions')
          .select(`
            *,
            clients:client_id (
              client_name,
              contact_info
            ),
            products:product_id (
              product_name,
              model,
              unit_price
            )
          `)
          .order('transaction_date', { ascending: false }),
        supabase.from('payments').select('*').eq('transaction_type', 'client').order('payment_date', { ascending: false })
      ])
      
      if (clientsResult.error) throw clientsResult.error
      if (productsResult.error) throw productsResult.error
      if (transactionsResult.error) throw transactionsResult.error
      if (paymentsResult.error) throw paymentsResult.error
      
      setClients(clientsResult.data || [])
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
      .channel('client_transactions_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'client_transactions'
        },
        () => {
          fetchData()
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

  const handleClientInput = (value) => {
    setFormData({ ...formData, client_name: value, client_id: '' })
    if (value.length > 0) {
      const filtered = clients.filter(c => 
        c.client_name.toLowerCase().includes(value.toLowerCase())
      )
      setClientSuggestions(filtered)
      setShowClientSuggestions(true)
    } else {
      setClientSuggestions([])
      setShowClientSuggestions(false)
    }
  }

  const handleClientSelect = (client) => {
    setFormData({ ...formData, client_id: client.client_id, client_name: client.client_name })
    setShowClientSuggestions(false)
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
      // Handle client - create if doesn't exist
      let clientId = formData.client_id
      if (!clientId && formData.client_name) {
        // Check if client exists
        const { data: existingClient } = await supabase
          .from('clients')
          .select('client_id')
          .eq('client_name', formData.client_name.trim())
          .single()
        
        if (existingClient) {
          clientId = existingClient.client_id
        } else {
          // Create new client
          const { data: newClient, error: clientError } = await supabase
            .from('clients')
            .insert([{ client_name: formData.client_name.trim() }])
            .select()
            .single()
          
          if (clientError) throw clientError
          clientId = newClient.client_id
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
        client_id: parseInt(clientId),
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
          .from('client_transactions')
          .update(transactionData)
          .eq('transaction_id', transactionId)
        
        if (error) throw error
        
        // Sync paid_amount with payments table
        // Get current payments total
        const { data: existingPayments } = await supabase
          .from('payments')
          .select('payment_amount')
          .eq('transaction_id', transactionId)
          .eq('transaction_type', 'client')
        
        const currentPaymentsTotal = existingPayments?.reduce((sum, p) => sum + parseFloat(p.payment_amount || 0), 0) || 0
        
        // If new paid_amount > current payments total, add a payment for the difference
        if (newPaidAmount > currentPaymentsTotal) {
          const difference = newPaidAmount - currentPaymentsTotal
          const { error: paymentError } = await supabase
            .from('payments')
            .insert([{
              transaction_id: transactionId,
              transaction_type: 'client',
              payment_amount: difference,
              payment_date: formData.transaction_date
            }])
          
          if (paymentError) {
            console.error('Error syncing payment:', paymentError)
          }
        }
        // If new paid_amount < current payments total, we keep existing payments
        // (can't remove specific payments automatically)
        
        success(t('clientTransactions.transactionUpdated'))
      } else {
        // Insert the transaction and get the transaction_id
        const { data: newTransaction, error } = await supabase
          .from('client_transactions')
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
              transaction_type: 'client',
              payment_amount: paidAmount,
              payment_date: formData.transaction_date
            }])
          
          if (paymentError) {
            console.error('Error creating initial payment:', paymentError)
            // Don't throw - transaction was created successfully, payment is secondary
          }
        }
        
        success(t('clientTransactions.transactionCreated'))
      }

      setShowModal(false)
      setEditingTransaction(null)
      setFormData({
        client_id: '',
        client_name: '',
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
      client_id: transaction.client_id ? transaction.client_id.toString() : '',
      product_id: transaction.product_id ? transaction.product_id.toString() : '',
      quantity: transaction.quantity.toString(),
      total_amount: transaction.total_amount.toString(),
      paid_amount: transaction.paid_amount.toString(),
      transaction_date: transaction.transaction_date,
      client_name: transaction.clients?.client_name || '',
      product_name: transaction.products?.product_name || '',
      product_price: (transaction.unit_price !== undefined && transaction.unit_price !== null)
        ? transaction.unit_price.toString()
        : (transaction.products?.unit_price !== undefined && transaction.products?.unit_price !== null ? transaction.products.unit_price.toString() : (transaction.quantity ? (parseFloat(transaction.total_amount) / transaction.quantity).toFixed(2) : ''))
    })
    setShowModal(true)
  }

  const handleDelete = async (transactionId) => {
    if (!window.confirm(t('clientTransactions.deleteConfirm'))) return

    try {
      // First, delete all payments associated with this transaction
      const { error: paymentsError } = await supabase
        .from('payments')
        .delete()
        .eq('transaction_id', transactionId)
        .eq('transaction_type', 'client')
      
      if (paymentsError) throw paymentsError
      
      // Then delete the transaction
      const { error } = await supabase
        .from('client_transactions')
        .delete()
        .eq('transaction_id', transactionId)
      
      if (error) throw error
      success(t('clientTransactions.transactionDeleted'))
      await fetchData()
    } catch (err) {
      console.error('Error deleting transaction:', err)
      showError('Error deleting transaction: ' + err.message)
    }
  }

  const getPaymentsForTransaction = (transactionId) => {
    // Only return payments for client transactions
    const clientTransactionIds = transactions.map(t => t.transaction_id)
    return payments.filter(p => 
      p.transaction_id === transactionId && 
      clientTransactionIds.includes(p.transaction_id)
    )
  }

  const handleAddPayment = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    
    try {
      const transactionId = parseInt(paymentFormData.transaction_id)
      
      // First, verify the transaction exists in client_transactions
      const { data: transaction, error: fetchError } = await supabase
        .from('client_transactions')
        .select('*')
        .eq('transaction_id', transactionId)
        .single()

      if (fetchError || !transaction) {
        throw new Error(`Transaction not found in client transactions. Please ensure this is a client transaction.`)
      }

      // Check if transaction exists in supplier_transactions (should not)
      const { data: supplierCheck } = await supabase
        .from('supplier_transactions')
        .select('transaction_id')
        .eq('transaction_id', transactionId)
        .single()

      if (supplierCheck) {
        throw new Error('This transaction ID exists in supplier transactions. Cannot add payment to client transaction.')
      }

      // Calculate new amounts before inserting
      const newPaidAmount = parseFloat(transaction.paid_amount || 0) + parseFloat(paymentFormData.payment_amount)
      const newRemainingAmount = parseFloat(transaction.total_amount) - newPaidAmount

      // Insert the payment with transaction_type
      const { data: paymentData, error: paymentError } = await supabase
        .from('payments')
        .insert([{
          transaction_id: transactionId,
          transaction_type: 'client',
          payment_amount: parseFloat(paymentFormData.payment_amount),
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
        .from('client_transactions')
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
        .from('client_transactions')
        .select('*')
        .eq('transaction_id', transactionId)
        .single()

      const newPaidAmount = Math.max(0, parseFloat(transaction.paid_amount || 0) - parseFloat(payment.payment_amount))
      const newRemainingAmount = parseFloat(transaction.total_amount) - newPaidAmount

      await supabase
        .from('client_transactions')
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

    // Client filter
    if (filterClientId) {
      result = result.filter(t => t.client_id === parseInt(filterClientId))
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

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      result = result.filter(t => {
        const clientName = (t.clients?.client_name || '').toLowerCase()
        const productName = (t.products?.product_name || '').toLowerCase()
        const model = (t.products?.model || '').toLowerCase()
        return clientName.includes(q) || productName.includes(q) || model.includes(q)
      })
    }

    return result
  }

  const hasActiveFilters = filterClientId || filterProductId || filterPaymentStatus !== 'all' || searchQuery.trim()
  const clearFilters = () => {
    setFilterClientId('')
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
  }, [filterClientId, filterProductId, filterPaymentStatus, searchQuery, selectedMonth, includePastRemaining])

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
      [t('clientTransactions.date')]: tx.transaction_date,
      [t('clientTransactions.client')]: tx.clients?.client_name || '',
      [t('clientTransactions.product')]: tx.products?.product_name || '',
      [t('clientTransactions.quantity')]: tx.quantity,
      [t('clientTransactions.unitPrice')]: tx.unit_price ?? (tx.quantity ? parseFloat(tx.total_amount) / tx.quantity : ''),
      [t('clientTransactions.totalAmount')]: tx.total_amount,
      [t('clientTransactions.paidAmount')]: tx.paid_amount,
      [t('clientTransactions.remainingAmount')]: tx.remaining_amount
    }))

    downloadCsv('client-transactions.csv', rows)
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

  const resetForm = () => {
    setEditingTransaction(null)
    setFormData({
      client_id: '',
      client_name: '',
      product_id: '',
      product_name: '',
      product_price: '',
      quantity: '',
      total_amount: '',
      paid_amount: '0',
      transaction_date: new Date().toISOString().split('T')[0]
    })
    setClientSuggestions([])
    setProductSuggestions([])
    setShowClientSuggestions(false)
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
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">{t('clientTransactions.title')}</h2>
          <p className="text-gray-600 mt-1 text-lg">{t('clientTransactions.subtitle')}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-2 px-4 rounded text-base"
          >
            {t('common.exportCsv')}
          </button>
          <button
            onClick={() => {
              resetForm()
              setShowModal(true)
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded shadow-md text-lg"
          >
            {t('clientTransactions.addTransaction')}
          </button>
        </div>
      </div>

      {/* Month Filter - Improved UX */}
      <div className="bg-white p-4 rounded-lg shadow-md border border-gray-200">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-gray-700">{t('clientTransactions.selectMonth')}:</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (selectedMonth) {
                    const [year, month] = selectedMonth.split('-')
                    const date = new Date(parseInt(year), parseInt(month) - 2, 1)
                    setSelectedMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`)
                  }
                }}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-base font-medium"
                title="Previous Month"
              >
                ‹
              </button>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="px-4 py-2 border-2 border-gray-300 rounded text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[160px]"
              />
              <button
                onClick={() => {
                  if (selectedMonth) {
                    const [year, month] = selectedMonth.split('-')
                    const date = new Date(parseInt(year), parseInt(month), 1)
                    setSelectedMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`)
                  }
                }}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-base font-medium"
                title="Next Month"
              >
                ›
              </button>
            </div>
          </div>
          <button
            onClick={() => {
              const now = new Date()
              setSelectedMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
            }}
            className="px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded text-base font-medium"
          >
            {t('clientTransactions.currentMonth')}
          </button>
          <button
            onClick={() => setSelectedMonth('')}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-base font-medium"
          >
            {t('clientTransactions.allMonths')}
          </button>
        </div>
        {selectedMonth && (
          <div className="mt-3 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="text-sm text-gray-600">
              Showing transactions for: <span className="font-semibold">
                {new Date(selectedMonth + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </span>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includePastRemaining}
                onChange={(e) => setIncludePastRemaining(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Include past remaining amounts</span>
            </label>
          </div>
        )}
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-lg shadow-md border border-gray-200">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-600">{t('common.filters')}:</span>
            <input
              type="text"
              placeholder={t('common.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[140px]"
            />
            <select
              value={filterClientId}
              onChange={(e) => setFilterClientId(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[120px]"
            >
              <option value="">{t('common.filterByClient')} – {t('common.all')}</option>
              {clients.map((c) => (
                <option key={c.client_id} value={c.client_id}>{c.client_name}</option>
              ))}
            </select>
            <select
              value={filterProductId}
              onChange={(e) => setFilterProductId(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[140px]"
            >
              <option value="">{t('common.filterByProduct')} – {t('common.all')}</option>
              {products.map((p) => (
                <option key={p.product_id} value={p.product_id}>
                  {p.product_name}{p.model ? ` (${p.model})` : ''}
                </option>
              ))}
            </select>
            <select
              value={filterPaymentStatus}
              onChange={(e) => setFilterPaymentStatus(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[130px]"
            >
              <option value="all">{t('common.paymentStatus')}: {t('common.all')}</option>
              <option value="outstanding">{t('common.outstanding')}</option>
              <option value="paid">{t('common.paidInFull')}</option>
            </select>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                {t('common.clearFilters')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-blue-600 text-white p-6 rounded shadow-md">
          <p className="text-lg font-medium mb-2">{t('clientTransactions.totalAmount')}</p>
          <p className="text-3xl font-bold">${calculateTotal().toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
        <div className="bg-green-600 text-white p-6 rounded shadow-md">
          <p className="text-lg font-medium mb-2">{t('clientTransactions.paidAmount')}</p>
          <p className="text-3xl font-bold">${calculatePaid().toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
        <div className="bg-red-600 text-white p-6 rounded shadow-md">
          <p className="text-lg font-medium mb-2">{t('clientTransactions.remainingAmount')}</p>
          <p className="text-3xl font-bold">${calculateRemaining().toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-white dark:bg-gray-800 shadow-md rounded overflow-hidden">
        <div className="overflow-x-auto overflow-y-visible">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 table-fixed">
            <thead className="bg-gray-100 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase w-24">{t('clientTransactions.date')}</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase w-[14%] min-w-0">{t('clientTransactions.client')}</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase w-[14%] min-w-0">{t('clientTransactions.product')}</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase w-20">{t('clientTransactions.quantity')}</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase w-24">{t('clientTransactions.unitPrice')}</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase w-24">{t('clientTransactions.total')}</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase w-24">{t('clientTransactions.paid')}</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase w-24">{t('clientTransactions.remaining')}</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase w-40">{t('clientTransactions.actions')}</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-6 py-8 text-center text-gray-500 dark:text-gray-400 text-lg">
                    {t('clientTransactions.noTransactions')}
                  </td>
                </tr>
              ) : (
                paginatedTransactions.map((transaction) => {
                const transactionPayments = getPaymentsForTransaction(transaction.transaction_id)
                const isExpanded = expandedRows.has(transaction.transaction_id)
                return (
                  <React.Fragment key={transaction.transaction_id}>
                    <tr className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-6 py-4 whitespace-nowrap text-base text-gray-900 dark:text-gray-100">
                        {new Date(transaction.transaction_date).toLocaleDateString()}
                      </td>
                      <td className="table-cell-wrap font-medium text-base" title={transaction.clients?.client_name || 'N/A'}>
                        {transaction.clients?.client_name || 'N/A'}
                      </td>
                      <td className="table-cell-wrap text-base" title={`${transaction.products?.product_name || 'N/A'}${transaction.products?.model ? ` (${transaction.products.model})` : ''}`}>
                        {transaction.products?.product_name || 'N/A'}
                        {transaction.products?.model && (
                          <span className="text-gray-500 dark:text-gray-400 text-sm ml-1">({transaction.products.model})</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-base text-gray-900 dark:text-gray-100">
                        {transaction.quantity}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-base text-gray-900 dark:text-gray-100">
                        ${(transaction.unit_price ?? (transaction.quantity ? parseFloat(transaction.total_amount) / transaction.quantity : 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-base font-semibold text-gray-900 dark:text-gray-100">
                        ${parseFloat(transaction.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-base font-medium text-green-700 dark:text-green-400">
                        ${parseFloat(transaction.paid_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-base font-medium text-red-700 dark:text-red-400">
                        ${parseFloat(transaction.remaining_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4 text-base font-medium min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => toggleRowExpansion(transaction.transaction_id)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                              isExpanded
                                ? 'bg-blue-100 text-blue-800 ring-2 ring-blue-200'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 hover:text-gray-900'
                            }`}
                          >
                            <span className={`inline-block transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                            {t('paymentsBreakdown.payments')}
                            <span className={`ml-0.5 px-1.5 py-0.5 rounded-md text-xs font-semibold ${isExpanded ? 'bg-blue-200 text-blue-900' : 'bg-gray-200 text-gray-600'}`}>
                              {transactionPayments.length}
                            </span>
                          </button>
                          <button
                            onClick={() => handleEdit(transaction)}
                            className="px-3 py-1.5 text-blue-600 hover:bg-blue-50 rounded-lg hover:text-blue-800 text-sm font-medium transition-colors"
                          >
                            {t('clientTransactions.edit')}
                          </button>
                          <button
                            onClick={() => handleDelete(transaction.transaction_id)}
                            className="px-3 py-1.5 text-red-600 hover:bg-red-50 rounded-lg hover:text-red-800 text-sm font-medium transition-colors"
                          >
                            {t('clientTransactions.delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan="9" className="px-6 py-0 align-top">
                          <div className="py-4 pl-4 pr-2 -mr-2 border-l-4 border-blue-200 bg-gradient-to-r from-blue-50/80 to-transparent rounded-r-lg mb-2">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                              <div className="flex items-center gap-4">
                                <h4 className="font-semibold text-gray-800 text-base flex items-center gap-2">
                                  <span className="w-2 h-5 bg-blue-500 rounded"></span>
                                  {t('paymentsBreakdown.payments')}
                                </h4>
                                <div className="flex gap-3 text-sm">
                                  <span className="text-green-700 font-medium">
                                    {t('dashboard.paid')}: ${parseFloat(transaction.paid_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                  </span>
                                  <span className="text-red-600 font-medium">
                                    {t('dashboard.remaining')}: ${parseFloat(transaction.remaining_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                  </span>
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
                                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors shrink-0"
                              >
                                <span>+</span> {t('paymentsBreakdown.addPayment')}
                              </button>
                            </div>
                            {transactionPayments.length > 0 ? (
                              <div className="space-y-2">
                                {transactionPayments.map((payment, idx) => (
                                  <div
                                    key={payment.payment_id}
                                    className="flex items-center justify-between gap-4 p-3 bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow"
                                  >
                                    <div className="flex items-center gap-4 min-w-0">
                                      <span className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-green-100 text-green-700 font-semibold text-sm">
                                        {idx + 1}
                                      </span>
                                      <div>
                                        <p className="font-semibold text-green-700 text-base">
                                          ${parseFloat(payment.payment_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </p>
                                        <p className="text-gray-500 text-sm">
                                          {new Date(payment.payment_date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                                        </p>
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => handleDeletePayment(payment.payment_id, transaction.transaction_id)}
                                      className="flex-shrink-0 px-3 py-1.5 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors"
                                    >
                                      {t('paymentsBreakdown.deletePayment')}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-gray-500 text-sm py-4 text-center bg-white rounded-lg border border-dashed border-gray-300">
                                {t('paymentsBreakdown.noClientPayments')}
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
            <div className="text-center py-16">
              <p className="text-gray-500 dark:text-gray-400 text-lg font-medium">{t('clientTransactions.noTransactions')}</p>
              <p className="text-gray-400 text-base mt-2">{t('clientTransactions.noTransactionsDesc')}</p>
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
              <div className="bg-blue-600 px-6 py-4">
                <h3 className="text-xl font-bold text-white">
                  {editingTransaction ? t('clientTransactions.editTransaction') : t('clientTransactions.addTransaction')}
                </h3>
              </div>
              <form onSubmit={handleSubmit}>
                <div className="bg-white px-6 pt-6 pb-4 space-y-4">
                  <div className="relative autocomplete-container">
                    <label className="block text-base font-semibold text-gray-700 mb-2">{t('clientTransactions.client')} *</label>
                    <input
                      type="text"
                      required
                      value={formData.client_name}
                      onChange={(e) => handleClientInput(e.target.value)}
                      onFocus={() => formData.client_name && handleClientInput(formData.client_name)}
                      placeholder={t('clientTransactions.selectClient')}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    {showClientSuggestions && clientSuggestions.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border-2 border-gray-300 rounded shadow-lg max-h-60 overflow-auto">
                        {clientSuggestions.map((client) => (
                          <div
                            key={client.client_id}
                            onClick={() => handleClientSelect(client)}
                            className="px-4 py-2 hover:bg-blue-50 cursor-pointer text-base"
                          >
                            {client.client_name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="relative autocomplete-container">
                    <label className="block text-base font-semibold text-gray-700 mb-2">{t('clientTransactions.product')} *</label>
                    <input
                      type="text"
                      required
                      value={formData.product_name}
                      onChange={(e) => handleProductInput(e.target.value)}
                      onFocus={() => formData.product_name && handleProductInput(formData.product_name)}
                      placeholder={t('clientTransactions.selectProduct')}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    {showProductSuggestions && productSuggestions.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border-2 border-gray-300 rounded shadow-lg max-h-60 overflow-auto">
                        {productSuggestions.map((product) => (
                          <div
                            key={product.product_id}
                            onClick={() => handleProductSelect(product)}
                            className="px-4 py-2 hover:bg-blue-50 cursor-pointer text-base"
                          >
                            {product.product_name} - ${product.unit_price}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-base font-semibold text-gray-700 mb-2">{t('clientTransactions.unitPrice')} *</label>
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
                        className="w-full px-4 py-3 border-2 border-gray-300 rounded text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  <div>
                    <label className="block text-base font-semibold text-gray-700 mb-2">{t('clientTransactions.quantity')} *</label>
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
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-base font-semibold text-gray-700 mb-2">{t('clientTransactions.totalAmount')} *</label>
                    <input
                      type="number"
                      required
                      step="0.01"
                      min="0"
                      value={formData.total_amount}
                      onChange={(e) => setFormData({ ...formData, total_amount: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-base font-semibold text-gray-700 mb-2">{t('clientTransactions.paidAmount')}</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.paid_amount}
                      onChange={(e) => setFormData({ ...formData, paid_amount: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-base font-semibold text-gray-700 mb-2">{t('clientTransactions.transactionDate')} *</label>
                    <input
                      type="date"
                      required
                      value={formData.transaction_date}
                      onChange={(e) => setFormData({ ...formData, transaction_date: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
                <div className="bg-gray-50 px-6 py-4 flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-3 space-y-2 space-y-reverse sm:space-y-0">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="w-full sm:w-auto px-6 py-3 border-2 border-gray-300 rounded text-gray-700 font-semibold hover:bg-gray-100 text-base"
                  >
                    {t('clientTransactions.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full sm:w-auto px-6 py-3 bg-blue-600 text-white font-semibold rounded hover:bg-blue-700 shadow-md disabled:opacity-50 disabled:cursor-not-allowed text-base flex items-center justify-center space-x-2"
                  >
                    {submitting ? (
                      <>
                        <LoadingSpinner size="sm" />
                        <span>{t('clientTransactions.saving')}</span>
                      </>
                    ) : (
                      <span>{editingTransaction ? t('clientTransactions.updateTransaction') : t('clientTransactions.createTransaction')}</span>
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
                    {t('clientTransactions.cancel')}
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

export default ClientTransactions
