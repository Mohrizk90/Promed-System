import React, { useEffect, useState, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getPaginationPrefs, setPaginationPrefs } from '../utils/paginationPrefs'
import { useToast } from '../context/ToastContext'
import { useLanguage } from '../context/LanguageContext'
import LoadingSpinner from './LoadingSpinner'
import { MetricSkeleton, ChartSkeleton } from './TableSkeleton'
import EmptyState from './ui/EmptyState'
import DateRangePicker from './ui/DateRangePicker'
import Tooltip from './ui/Tooltip'
import Pagination from './ui/Pagination'
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  CreditCard,
  Wallet,
  Activity,
  RefreshCw,
  Download,
  ArrowUpRight,
  ArrowDownRight,
  Printer,
  Package,
} from './ui/Icons'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts'

function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [clientTransactions, setClientTransactions] = useState([])
  const [supplierTransactions, setSupplierTransactions] = useState([])
  const [payments, setPayments] = useState([])
  const [liabilities, setLiabilities] = useState([])
  const [dateRange, setDateRange] = useState({ start: null, end: null })
  const [quickFilter, setQuickFilter] = useState('all') // all, month, quarter, year
  const [showComparison, setShowComparison] = useState(false)
  const { error: showError } = useToast()
  const { t, language } = useLanguage()

  useEffect(() => {
    fetchData()
    const cleanup = subscribeToChanges()
    return () => {
      if (cleanup) cleanup()
    }
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)

      const [clientTxResult, supplierTxResult, paymentsResult, liabilitiesResult] = await Promise.all([
        supabase
          .from('client_transactions')
          .select(`*, clients:client_id (client_name), products:product_id (product_name)`)
          .order('transaction_date', { ascending: true }),
        supabase
          .from('supplier_transactions')
          .select(`*, suppliers:supplier_id (supplier_name), products:product_id (product_name)`)
          .order('transaction_date', { ascending: true }),
        supabase
          .from('payments')
          .select('*')
          .order('payment_date', { ascending: false }),
        supabase.from('liabilities').select('*').order('created_at', { ascending: false }),
      ])

      if (clientTxResult.error) throw clientTxResult.error
      if (supplierTxResult.error) throw supplierTxResult.error
      if (paymentsResult.error) throw paymentsResult.error

      setClientTransactions(clientTxResult.data || [])
      setSupplierTransactions(supplierTxResult.data || [])
      setPayments(paymentsResult.data || [])
      setLiabilities(liabilitiesResult.error ? [] : (liabilitiesResult.data || []))
    } catch (err) {
      console.error('Error loading dashboard data:', err)
      showError('Error loading dashboard: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const CLIENT_TX_SELECT = `*, clients:client_id (client_name), products:product_id (product_name)`
  const SUPPLIER_TX_SELECT = `*, suppliers:supplier_id (supplier_name), products:product_id (product_name)`

  const fetchOneClientTransaction = async (id) => {
    const { data, error } = await supabase
      .from('client_transactions')
      .select(CLIENT_TX_SELECT)
      .eq('id', id)
      .single()
    return error ? null : data
  }

  const fetchOneSupplierTransaction = async (id) => {
    const { data, error } = await supabase
      .from('supplier_transactions')
      .select(SUPPLIER_TX_SELECT)
      .eq('id', id)
      .single()
    return error ? null : data
  }

  const subscribeToChanges = () => {
    const channel = supabase
      .channel('dashboard_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'client_transactions' },
        async (payload) => {
          const eventType = payload.eventType ?? (payload.old == null ? 'INSERT' : payload.new == null ? 'DELETE' : 'UPDATE')
          const newRow = payload.new
          const oldRow = payload.old
          if (eventType === 'INSERT' && newRow?.id) {
            const row = await fetchOneClientTransaction(newRow.id)
            if (row) setClientTransactions((prev) => [...prev, row].sort((a, b) => new Date(a.transaction_date) - new Date(b.transaction_date)))
          } else if (eventType === 'UPDATE' && newRow?.id) {
            const row = await fetchOneClientTransaction(newRow.id)
            if (row) setClientTransactions((prev) => prev.map((t) => (t.id === row.id ? row : t)))
          } else if (eventType === 'DELETE' && oldRow?.id) {
            setClientTransactions((prev) => prev.filter((t) => t.id !== oldRow.id))
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'supplier_transactions' },
        async (payload) => {
          const eventType = payload.eventType ?? (payload.old == null ? 'INSERT' : payload.new == null ? 'DELETE' : 'UPDATE')
          const newRow = payload.new
          const oldRow = payload.old
          if (eventType === 'INSERT' && newRow?.id) {
            const row = await fetchOneSupplierTransaction(newRow.id)
            if (row) setSupplierTransactions((prev) => [...prev, row].sort((a, b) => new Date(a.transaction_date) - new Date(b.transaction_date)))
          } else if (eventType === 'UPDATE' && newRow?.id) {
            const row = await fetchOneSupplierTransaction(newRow.id)
            if (row) setSupplierTransactions((prev) => prev.map((t) => (t.id === row.id ? row : t)))
          } else if (eventType === 'DELETE' && oldRow?.id) {
            setSupplierTransactions((prev) => prev.filter((t) => t.id !== oldRow.id))
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payments' },
        async (payload) => {
          const eventType = payload.eventType ?? (payload.old == null ? 'INSERT' : payload.new == null ? 'DELETE' : 'UPDATE')
          const newRow = payload.new
          const oldRow = payload.old
          const transactionId = newRow?.transaction_id ?? oldRow?.transaction_id
          const isClient = newRow?.transaction_type === 'client' || oldRow?.transaction_type === 'client'
          const isSupplier = newRow?.transaction_type === 'supplier' || oldRow?.transaction_type === 'supplier'
          if (!transactionId) return
          if (eventType === 'INSERT' && newRow) setPayments((prev) => [newRow, ...prev])
          else if (eventType === 'UPDATE' && newRow) setPayments((prev) => prev.map((p) => (p.id === newRow.id ? newRow : p)))
          else if (eventType === 'DELETE' && oldRow) setPayments((prev) => prev.filter((p) => p.id !== oldRow.id))
          if (isClient) {
            const row = await fetchOneClientTransaction(transactionId)
            if (row) setClientTransactions((prev) => prev.map((t) => (t.id === row.id ? row : t)))
          }
          if (isSupplier) {
            const row = await fetchOneSupplierTransaction(transactionId)
            if (row) setSupplierTransactions((prev) => prev.map((t) => (t.id === row.id ? row : t)))
          }
        }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }

  const currency = t('common.currency')
  const formatCurrency = (value) => {
    const num = Number(value) || 0
    const str = num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    return language === 'ar' ? str + ' ' + currency : currency + ' ' + str
  }

  const formatCurrencyDetailed = (value) => {
    const num = Number(value) || 0
    const str = num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return language === 'ar' ? str + ' ' + currency : currency + ' ' + str
  }

  // Get date range based on quick filter or custom range
  const getDateBounds = () => {
    if (dateRange.start && dateRange.end) {
      return { start: dateRange.start, end: dateRange.end }
    }

    const now = new Date()
    let start = null

    switch (quickFilter) {
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1)
        break
      case 'quarter':
        const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3
        start = new Date(now.getFullYear(), quarterStartMonth, 1)
        break
      case 'year':
        start = new Date(now.getFullYear(), 0, 1)
        break
      default:
        return { start: null, end: null }
    }

    return { start, end: now }
  }

  // Get previous period dates for comparison
  const getPreviousPeriodBounds = () => {
    const { start, end } = getDateBounds()
    if (!start || !end) return { start: null, end: null }

    const duration = end.getTime() - start.getTime()
    const prevEnd = new Date(start.getTime() - 1)
    const prevStart = new Date(prevEnd.getTime() - duration)

    return { start: prevStart, end: prevEnd }
  }

  // Filter transactions by date range
  const filterByDate = (transactions, bounds) => {
    if (!bounds.start) return transactions
    return transactions.filter(tx => {
      const date = new Date(tx.transaction_date)
      return date >= bounds.start && date <= bounds.end
    })
  }

  // Sum paid amounts from payments by payment_date in bounds (for correct period totals)
  const paidInPeriodFromPayments = (paymentsList, bounds, transactionType) => {
    if (!bounds?.start || !paymentsList?.length) return 0
    const start = bounds.start
    const end = bounds.end
    return paymentsList
      .filter(p => {
        if (p.transaction_type !== transactionType) return false
        const d = new Date(p.payment_date)
        return d >= start && d <= end
      })
      .reduce((sum, p) => sum + Number(p.payment_amount || 0), 0)
  }

  const currentBounds = getDateBounds()
  const previousBounds = getPreviousPeriodBounds()

  const filteredClientTransactions = useMemo(
    () => filterByDate(clientTransactions, currentBounds),
    [clientTransactions, currentBounds.start, currentBounds.end]
  )

  const filteredSupplierTransactions = useMemo(
    () => filterByDate(supplierTransactions, currentBounds),
    [supplierTransactions, currentBounds.start, currentBounds.end]
  )

  const prevClientTransactions = useMemo(
    () => filterByDate(clientTransactions, previousBounds),
    [clientTransactions, previousBounds.start, previousBounds.end]
  )

  const prevSupplierTransactions = useMemo(
    () => filterByDate(supplierTransactions, previousBounds),
    [supplierTransactions, previousBounds.start, previousBounds.end]
  )

  // Calculate metrics for a set of transactions (sales, remaining from txs; paid can be overridden by payment-date sums)
  const calculateMetrics = (clientTxs, supplierTxs, opts = {}) => {
    const { clientPaidOverride, supplierPaidOverride } = opts
    const totalClientSales = clientTxs.reduce((sum, tx) => sum + Number(tx.total_amount || 0), 0)
    const totalSupplierPurchases = supplierTxs.reduce((sum, tx) => sum + Number(tx.total_amount || 0), 0)
    const totalClientPaid = clientPaidOverride !== undefined
      ? clientPaidOverride
      : clientTxs.reduce((sum, tx) => sum + Number(tx.paid_amount || 0), 0)
    const totalSupplierPaid = supplierPaidOverride !== undefined
      ? supplierPaidOverride
      : supplierTxs.reduce((sum, tx) => sum + Number(tx.paid_amount || 0), 0)
    const totalClientRemaining = clientTxs.reduce((sum, tx) => sum + Number(tx.remaining_amount || 0), 0)
    const totalSupplierRemaining = supplierTxs.reduce((sum, tx) => sum + Number(tx.remaining_amount || 0), 0)

    return {
      totalClientSales,
      totalSupplierPurchases,
      totalClientPaid,
      totalSupplierPaid,
      totalClientRemaining,
      totalSupplierRemaining,
      netPosition: totalClientRemaining - totalSupplierRemaining,
      grossProfit: totalClientSales - totalSupplierPurchases,
      cashFlow: totalClientPaid - totalSupplierPaid,
      collectionRate: totalClientSales > 0 ? (totalClientPaid / totalClientSales) * 100 : 0,
      clientTransactionCount: clientTxs.length,
      supplierTransactionCount: supplierTxs.length,
    }
  }

  const clientPaidInPeriod = useMemo(
    () => (currentBounds.start ? paidInPeriodFromPayments(payments, currentBounds, 'client') : null),
    [payments, currentBounds.start, currentBounds.end]
  )
  const supplierPaidInPeriod = useMemo(
    () => (currentBounds.start ? paidInPeriodFromPayments(payments, currentBounds, 'supplier') : null),
    [payments, currentBounds.start, currentBounds.end]
  )
  const prevClientPaidInPeriod = useMemo(
    () => (previousBounds.start ? paidInPeriodFromPayments(payments, previousBounds, 'client') : null),
    [payments, previousBounds.start, previousBounds.end]
  )
  const prevSupplierPaidInPeriod = useMemo(
    () => (previousBounds.start ? paidInPeriodFromPayments(payments, previousBounds, 'supplier') : null),
    [payments, previousBounds.start, previousBounds.end]
  )

  const metrics = useMemo(() => {
    const base = calculateMetrics(filteredClientTransactions, filteredSupplierTransactions,
      currentBounds.start
        ? { clientPaidOverride: clientPaidInPeriod, supplierPaidOverride: supplierPaidInPeriod }
        : {}
    )
    return base
  }, [filteredClientTransactions, filteredSupplierTransactions, currentBounds.start, clientPaidInPeriod, supplierPaidInPeriod])

  const prevMetrics = useMemo(() => {
    const base = calculateMetrics(prevClientTransactions, prevSupplierTransactions,
      previousBounds.start
        ? { clientPaidOverride: prevClientPaidInPeriod, supplierPaidOverride: prevSupplierPaidInPeriod }
        : {}
    )
    return base
  }, [prevClientTransactions, prevSupplierTransactions, previousBounds.start, prevClientPaidInPeriod, prevSupplierPaidInPeriod])

  const pastRemainingBeforeStart = (txs, start) => {
    if (!start) return 0
    return (txs || [])
      .filter((tx) => {
        const d = new Date(tx.transaction_date)
        return d < start && Number(tx.remaining_amount || 0) > 0
      })
      .reduce((s, tx) => s + Number(tx.remaining_amount || 0), 0)
  }

  const pastClientRemaining = useMemo(
    () => (currentBounds.start ? pastRemainingBeforeStart(clientTransactions, currentBounds.start) : 0),
    [clientTransactions, currentBounds.start]
  )
  const pastSupplierRemaining = useMemo(
    () => (currentBounds.start ? pastRemainingBeforeStart(supplierTransactions, currentBounds.start) : 0),
    [supplierTransactions, currentBounds.start]
  )

  const accountsReceivableTotal = currentBounds.start
    ? (metrics.totalClientRemaining + pastClientRemaining)
    : metrics.totalClientRemaining
  const accountsPayableTotal = currentBounds.start
    ? (metrics.totalSupplierRemaining + pastSupplierRemaining)
    : metrics.totalSupplierRemaining

  const totalOtherLiabilitiesRemaining = useMemo(
    () => liabilities.reduce((s, l) => s + parseFloat(l.remaining_amount || 0), 0),
    [liabilities]
  )
  const totalLiabilitiesRemaining = metrics.totalSupplierRemaining + totalOtherLiabilitiesRemaining

  // Inventory value (current stock × avg buy price) — displayed only, not included in profit
  const totalInventoryValue = useMemo(() => {
    const supplierByProduct = new Map()
    const clientByProduct = new Map()
    supplierTransactions.forEach((tx) => {
      const pid = tx.product_id
      if (!supplierByProduct.has(pid)) supplierByProduct.set(pid, { qty: 0, total: 0 })
      const e = supplierByProduct.get(pid)
      e.qty += Number(tx.quantity) || 0
      e.total += Number(tx.total_amount) || 0
    })
    clientTransactions.forEach((tx) => {
      const pid = tx.product_id
      if (!clientByProduct.has(pid)) clientByProduct.set(pid, { qty: 0 })
      clientByProduct.get(pid).qty += Number(tx.quantity) || 0
    })
    let sum = 0
    const allProductIds = new Set([...supplierByProduct.keys(), ...clientByProduct.keys()])
    allProductIds.forEach((pid) => {
      const s = supplierByProduct.get(pid) || { qty: 0, total: 0 }
      const c = clientByProduct.get(pid) || { qty: 0 }
      const stockIn = s.qty
      const stockOut = c.qty
      const currentStock = stockIn - stockOut
      const avgBuyPrice = stockIn > 0 ? s.total / stockIn : 0
      if (currentStock > 0 && avgBuyPrice > 0) sum += currentStock * avgBuyPrice
    })
    return sum
  }, [clientTransactions, supplierTransactions])

  // Calculate percentage change
  const calculateChange = (current, previous) => {
    if (previous === 0) return current > 0 ? 100 : 0
    return ((current - previous) / Math.abs(previous)) * 100
  }

  // Generate sparkline data (last 7 days)
  const generateSparklineData = (transactions, field = 'total_amount') => {
    const last7Days = []
    const now = new Date()

    for (let i = 6; i >= 0; i--) {
      const date = new Date(now)
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]

      const dayTotal = transactions
        .filter(tx => tx.transaction_date === dateStr)
        .reduce((sum, tx) => sum + Number(tx[field] || 0), 0)

      last7Days.push({ day: i, value: dayTotal })
    }

    return last7Days
  }

  // Revenue vs Expenses over time
  const revenueExpensesData = useMemo(() => {
    const monthlyData = new Map()

    filteredClientTransactions.forEach(tx => {
      const date = new Date(tx.transaction_date)
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

      if (!monthlyData.has(monthKey)) {
        monthlyData.set(monthKey, { month: monthKey, revenue: 0, expenses: 0 })
      }

      monthlyData.get(monthKey).revenue += Number(tx.total_amount || 0)
    })

    filteredSupplierTransactions.forEach(tx => {
      const date = new Date(tx.transaction_date)
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

      if (!monthlyData.has(monthKey)) {
        monthlyData.set(monthKey, { month: monthKey, revenue: 0, expenses: 0 })
      }

      monthlyData.get(monthKey).expenses += Number(tx.total_amount || 0)
    })

    return Array.from(monthlyData.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-6)
  }, [filteredClientTransactions, filteredSupplierTransactions])

  // Payment status pie chart
  const paymentStatusData = useMemo(() => {
    return [
      { name: t('dashboard.clientPaid'), value: metrics.totalClientPaid, color: '#10b981' },
      { name: t('dashboard.clientRemaining'), value: metrics.totalClientRemaining, color: '#ef4444' },
      { name: t('dashboard.supplierPaid'), value: metrics.totalSupplierPaid, color: '#8b5cf6' },
      { name: t('dashboard.supplierRemaining'), value: metrics.totalSupplierRemaining, color: '#f59e0b' },
    ].filter(item => item.value > 0)
  }, [metrics, t])

  // Top clients by revenue (paid = payments in period when date filter is on)
  const topClientsData = useMemo(() => {
    const clientMap = new Map()
    const txIdToClient = new Map(
      clientTransactions.map(tx => [tx.transaction_id ?? tx.id, { id: tx.client_id, name: tx.clients?.client_name || 'Unknown' }])
    )

    filteredClientTransactions.forEach(tx => {
      const id = tx.client_id || 0
      const name = tx.clients?.client_name || 'Unknown'

      if (!clientMap.has(id)) {
        clientMap.set(id, { name, total: 0, paid: 0, remaining: 0 })
      }

      const client = clientMap.get(id)
      client.total += Number(tx.total_amount || 0)
      if (!currentBounds.start) client.paid += Number(tx.paid_amount || 0)
      client.remaining += Number(tx.remaining_amount || 0)
    })

    if (currentBounds.start && payments.length) {
      payments
        .filter(p => p.transaction_type === 'client')
        .forEach(p => {
          const d = new Date(p.payment_date)
          if (d < currentBounds.start || d > currentBounds.end) return
          const info = txIdToClient.get(p.transaction_id)
          if (!info) return
          const id = info.id || 0
          if (!clientMap.has(id)) clientMap.set(id, { name: info.name, total: 0, paid: 0, remaining: 0 })
          clientMap.get(id).paid += Number(p.payment_amount || 0)
        })
    }

    return Array.from(clientMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
  }, [filteredClientTransactions, clientTransactions, payments, currentBounds.start, currentBounds.end])

  // Top suppliers by purchases (paid = payments in period when date filter is on)
  const topSuppliersData = useMemo(() => {
    const supplierMap = new Map()
    const txIdToSupplier = new Map(
      supplierTransactions.map(tx => [tx.transaction_id ?? tx.id, { id: tx.supplier_id, name: tx.suppliers?.supplier_name || 'Unknown' }])
    )

    filteredSupplierTransactions.forEach(tx => {
      const id = tx.supplier_id || 0
      const name = tx.suppliers?.supplier_name || 'Unknown'

      if (!supplierMap.has(id)) {
        supplierMap.set(id, { name, total: 0, paid: 0, remaining: 0 })
      }

      const supplier = supplierMap.get(id)
      supplier.total += Number(tx.total_amount || 0)
      if (!currentBounds.start) supplier.paid += Number(tx.paid_amount || 0)
      supplier.remaining += Number(tx.remaining_amount || 0)
    })

    if (currentBounds.start && payments.length) {
      payments
        .filter(p => p.transaction_type === 'supplier')
        .forEach(p => {
          const d = new Date(p.payment_date)
          if (d < currentBounds.start || d > currentBounds.end) return
          const info = txIdToSupplier.get(p.transaction_id)
          if (!info) return
          const id = info.id || 0
          if (!supplierMap.has(id)) supplierMap.set(id, { name: info.name, total: 0, paid: 0, remaining: 0 })
          supplierMap.get(id).paid += Number(p.payment_amount || 0)
        })
    }

    return Array.from(supplierMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
  }, [filteredSupplierTransactions, supplierTransactions, payments, currentBounds.start, currentBounds.end])

  // Top products
  const topProductsData = useMemo(() => {
    const productMap = new Map()

    filteredClientTransactions.forEach(tx => {
      const id = tx.product_id || 0
      const name = tx.products?.product_name || 'Unknown'

      if (!productMap.has(id)) {
        productMap.set(id, { name, sold: 0, purchased: 0, revenue: 0, cost: 0 })
      }

      const product = productMap.get(id)
      product.sold += Number(tx.quantity || 0)
      product.revenue += Number(tx.total_amount || 0)
    })

    filteredSupplierTransactions.forEach(tx => {
      const id = tx.product_id || 0
      const name = tx.products?.product_name || 'Unknown'

      if (!productMap.has(id)) {
        productMap.set(id, { name, sold: 0, purchased: 0, revenue: 0, cost: 0 })
      }

      const product = productMap.get(id)
      product.purchased += Number(tx.quantity || 0)
      product.cost += Number(tx.total_amount || 0)
    })

    return Array.from(productMap.values())
      .map(p => ({ ...p, profit: p.revenue - p.cost }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [filteredClientTransactions, filteredSupplierTransactions])

  const [searchParams, setSearchParams] = useSearchParams()
  const PRODUCTS_PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100]
  const ROUTE_KEY = 'dashboard'

  useEffect(() => {
    if (searchParams.has('productsPageSize')) return
    const prefs = getPaginationPrefs(ROUTE_KEY)
    if (prefs && PRODUCTS_PAGE_SIZE_OPTIONS.includes(prefs.pageSize)) {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev)
        p.set('productsPage', String(prefs.page))
        p.set('productsPageSize', String(prefs.pageSize))
        return p
      })
    }
  }, [])

  const productsPage = Math.max(1, parseInt(searchParams.get('productsPage'), 10) || 1)
  const productsPageSizeParam = searchParams.get('productsPageSize')
  const productsPageSize = PRODUCTS_PAGE_SIZE_OPTIONS.includes(Number(productsPageSizeParam)) ? Number(productsPageSizeParam) : 10

  const setProductsPage = (page) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('productsPage', String(page))
      return p
    })
    setPaginationPrefs(ROUTE_KEY, { page, pageSize: productsPageSize })
  }
  const setProductsPageSizeAndReset = (size) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('productsPageSize', String(size))
      p.set('productsPage', '1')
      return p
    })
    setPaginationPrefs(ROUTE_KEY, { page: 1, pageSize: size })
  }

  const productsTotalPages = Math.max(1, Math.ceil(topProductsData.length / productsPageSize))
  const effectiveProductsPage = Math.min(productsPage, productsTotalPages)
  const paginatedProductsData = useMemo(() => {
    const start = (effectiveProductsPage - 1) * productsPageSize
    return topProductsData.slice(start, start + productsPageSize)
  }, [topProductsData, effectiveProductsPage, productsPageSize])

  const hasAnyData = clientTransactions.length > 0 || supplierTransactions.length > 0

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div className="h-10 skeleton w-64" />
          <div className="h-10 skeleton w-48" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <MetricSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      </div>
    )
  }

  if (!hasAnyData) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{t('dashboard.title')}</h1>
          <p className="text-gray-600">{t('dashboard.subtitle')}</p>
        </div>
        <EmptyState
          icon="dashboard"
          title={t('dashboard.noData')}
          description={t('dashboard.addTransactionsPrompt')}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-2">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-1">{t('dashboard.title')}</h1>
          <p className="text-gray-600">{t('dashboard.subtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <button type="button" onClick={() => window.print()} className="btn btn-secondary flex items-center gap-2">
            <Printer size={18} />
            {t('common.print')}
          </button>
          {/* Quick Filters */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {['all', 'month', 'quarter', 'year'].map(range => (
              <button
                key={range}
                onClick={() => {
                  setQuickFilter(range)
                  setDateRange({ start: null, end: null })
                }}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  quickFilter === range && !dateRange.start
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {range === 'all' ? t('dashboard.allTime') : range === 'month' ? t('dashboard.thisMonth') : range === 'quarter' ? t('dashboard.thisQuarter') : t('dashboard.thisYear')}
              </button>
            ))}
          </div>

          {/* Date Range Picker */}
          <DateRangePicker
            startDate={dateRange.start}
            endDate={dateRange.end}
            onChange={({ start, end }) => {
              setDateRange({ start, end })
              if (start) setQuickFilter('custom')
            }}
            placeholder="Custom range"
          />

          {/* Comparison Toggle */}
          <Tooltip content="Compare with previous period">
            <button
              onClick={() => setShowComparison(!showComparison)}
              className={`btn ${showComparison ? 'btn-primary' : 'btn-secondary'} btn-sm`}
            >
              <Activity size={16} />
              Compare
            </button>
          </Tooltip>

          {/* Refresh */}
          <button onClick={fetchData} className="btn btn-ghost btn-sm">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          title={t('dashboard.totalRevenue')}
          value={formatCurrency(metrics.totalClientSales)}
          subtitle={`${metrics.clientTransactionCount} ${t('dashboard.transactions')}`}
          icon={DollarSign}
          color="blue"
          change={showComparison ? calculateChange(metrics.totalClientSales, prevMetrics.totalClientSales) : null}
          sparklineData={generateSparklineData(filteredClientTransactions)}
        />

        <MetricCard
          title={t('dashboard.totalExpenses')}
          value={formatCurrency(metrics.totalSupplierPurchases)}
          subtitle={`${metrics.supplierTransactionCount} ${t('dashboard.transactions')}`}
          icon={CreditCard}
          color="purple"
          change={showComparison ? calculateChange(metrics.totalSupplierPurchases, prevMetrics.totalSupplierPurchases) : null}
          sparklineData={generateSparklineData(filteredSupplierTransactions)}
          invertChange
        />

        <MetricCard
          title={t('dashboard.grossProfit')}
          value={formatCurrency(metrics.grossProfit)}
          subtitle={metrics.totalClientSales > 0 ? `${((metrics.grossProfit / metrics.totalClientSales) * 100).toFixed(1)}% ${t('dashboard.margin')}` : ''}
          icon={TrendingUp}
          color={metrics.grossProfit >= 0 ? 'green' : 'red'}
          change={showComparison ? calculateChange(metrics.grossProfit, prevMetrics.grossProfit) : null}
        />

        <MetricCard
          title={t('dashboard.cashFlow')}
          value={formatCurrency(metrics.cashFlow)}
          subtitle={`${formatCurrency(metrics.totalClientPaid)} ${t('dashboard.inLabel')} / ${formatCurrency(metrics.totalSupplierPaid)} ${t('dashboard.outLabel')}`}
          icon={Wallet}
          color={metrics.cashFlow >= 0 ? 'green' : 'red'}
          change={showComparison ? calculateChange(metrics.cashFlow, prevMetrics.cashFlow) : null}
        />
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Link to="/" className="block transition-opacity hover:opacity-90">
          <MetricCard
            title={t('dashboard.collectionRate')}
            value={`${metrics.collectionRate.toFixed(1)}%`}
            subtitle={`${formatCurrency(metrics.totalClientPaid)} ${t('dashboard.collected')}`}
            color="green"
            small
            change={showComparison ? calculateChange(metrics.collectionRate, prevMetrics.collectionRate) : null}
          />
        </Link>

        <Link to="/?paymentStatus=outstanding" className="block transition-opacity hover:opacity-90">
          <MetricCard
            title={t('dashboard.accountsReceivable')}
            value={formatCurrency(accountsReceivableTotal)}
            subtitle={
              currentBounds.start
                ? `${t('common.current')}: ${formatCurrency(metrics.totalClientRemaining)} / ${t('common.previous')}: ${formatCurrency(pastClientRemaining)}`
                : t('dashboard.outstandingFromClients')
            }
            color="orange"
            small
          />
        </Link>

        <Link to="/suppliers?paymentStatus=outstanding" className="block transition-opacity hover:opacity-90">
          <MetricCard
            title={t('dashboard.accountsPayable')}
            value={formatCurrency(accountsPayableTotal)}
            subtitle={
              currentBounds.start
                ? `${t('common.current')}: ${formatCurrency(metrics.totalSupplierRemaining)} / ${t('common.previous')}: ${formatCurrency(pastSupplierRemaining)}`
                : t('dashboard.owedToSuppliers')
            }
            color="red"
            small
          />
        </Link>

        <MetricCard
          title={t('dashboard.netPositionShort')}
          value={formatCurrency(metrics.netPosition)}
          subtitle={metrics.netPosition >= 0 ? t('dashboard.positive') : t('dashboard.negative')}
          color={metrics.netPosition >= 0 ? 'green' : 'red'}
          small
        />

        <Link to="/liabilities" className="block transition-opacity hover:opacity-90">
          <MetricCard
            title={t('dashboard.totalLiabilities')}
            value={formatCurrency(totalLiabilitiesRemaining)}
            subtitle={t('dashboard.supplierPayablesAndOther')}
            color="red"
            small
          />
        </Link>

        <Link to="/products" className="block transition-opacity hover:opacity-90">
          <MetricCard
            title={t('dashboard.inventoryValue')}
            value={formatCurrency(totalInventoryValue)}
            subtitle={t('dashboard.inventoryValueSubtitle')}
            icon={Package}
            color="blue"
            small
          />
        </Link>
      </div>

      {/* Charts Row 1 - LTR so charts render correctly in Arabic/RTL */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue vs Expenses Trend */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('dashboard.revenueVsExpensesTrend')}</h2>
          <div dir="ltr" className="min-w-0 w-full">
          <ResponsiveContainer width="100%" height={350}>
            <AreaChart data={revenueExpensesData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-300)" />
              <XAxis dataKey="month" stroke="var(--text-tertiary)" />
              <YAxis stroke="var(--text-tertiary)" />
              <RechartsTooltip
                formatter={(value) => formatCurrency(value)}
                contentStyle={{ backgroundColor: 'var(--color-surface-50)', border: '1px solid var(--color-surface-300)', borderRadius: '0.5rem' }}
              />
              <Legend />
              <Area type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorRevenue)" name={t('dashboard.revenue')} />
              <Area type="monotone" dataKey="expenses" stroke="#8b5cf6" strokeWidth={2} fillOpacity={1} fill="url(#colorExpenses)" name={t('dashboard.totalExpenses')} />
            </AreaChart>
          </ResponsiveContainer>
          </div>
        </div>

        {/* Payment Status Distribution */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('dashboard.paymentStatusDistribution')}</h2>
          <div dir="ltr" className="min-w-0 w-full">
          <ResponsiveContainer width="100%" height={350}>
            <PieChart>
              <Pie
                data={paymentStatusData}
                cx="50%"
                cy="50%"
                innerRadius={80}
                outerRadius={120}
                paddingAngle={2}
                dataKey="value"
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
              >
                {paymentStatusData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <RechartsTooltip formatter={(value) => formatCurrency(value)} />
            </PieChart>
          </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Charts Row 2 - LTR so charts render correctly in Arabic/RTL */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Clients */}
        <Link to="/" className="block transition-opacity hover:opacity-95">
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('dashboard.topClientsByRevenue')}</h2>
          <div dir="ltr" className="min-w-0 w-full">
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={topClientsData} layout="vertical" margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-300)" />
              <XAxis type="number" stroke="var(--text-tertiary)" />
              <YAxis dataKey="name" type="category" width={100} stroke="var(--text-tertiary)" />
              <RechartsTooltip formatter={(value) => formatCurrency(value)} />
              <Legend />
              <Bar dataKey="total" fill="#3b82f6" name={t('dashboard.totalRevenueLong')} radius={[0, 4, 4, 0]} />
              <Bar dataKey="remaining" fill="#ef4444" name={t('dashboard.outstandingLabel')} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          </div>
        </div>
        </Link>

        {/* Top Suppliers */}
        <Link to="/suppliers" className="block transition-opacity hover:opacity-95">
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('dashboard.topSuppliersByPurchases')}</h2>
          <div dir="ltr" className="min-w-0 w-full">
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={topSuppliersData} layout="vertical" margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-300)" />
              <XAxis type="number" stroke="var(--text-tertiary)" />
              <YAxis dataKey="name" type="category" width={100} stroke="var(--text-tertiary)" />
              <RechartsTooltip formatter={(value) => formatCurrency(value)} />
              <Legend />
              <Bar dataKey="total" fill="#8b5cf6" name={t('dashboard.totalPurchases')} radius={[0, 4, 4, 0]} />
              <Bar dataKey="remaining" fill="#f59e0b" name={t('dashboard.outstandingLabel')} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          </div>
        </div>
        </Link>
      </div>

      {/* Top Products Table */}
      <div className="card p-4">
        <h2 className="text-base font-semibold text-gray-900 mb-3">{t('dashboard.topProductsPerformance')}</h2>
        <div className="overflow-x-auto overflow-y-visible">
          <table className="min-w-full divide-y divide-gray-200 table-fixed">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[25%] min-w-0">{t('dashboard.product')}</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-20">{t('dashboard.qtySold')}</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-24">{t('dashboard.qtyPurchased')}</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-24">{t('dashboard.revenue')}</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-24">{t('dashboard.cost')}</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-24">{t('dashboard.profit')}</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-20">{t('dashboard.profitMargin')}</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {paginatedProductsData.map((product, index) => (
                <tr key={index} className="hover:bg-gray-50 transition-colors">
                  <td className="table-cell-wrap px-4 py-2 text-sm font-medium text-gray-900" title={product.name}>{product.name}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-right text-gray-900">{product.sold}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-right text-gray-900">{product.purchased}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-right font-medium text-blue-600">{formatCurrencyDetailed(product.revenue)}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-right font-medium text-purple-600">{formatCurrencyDetailed(product.cost)}</td>
                  <td className={`px-4 py-2 whitespace-nowrap text-sm text-right font-semibold ${product.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrencyDetailed(product.profit)}
                  </td>
                  <td className={`px-4 py-2 whitespace-nowrap text-sm text-right font-medium ${product.revenue > 0 && (product.profit / product.revenue) >= 0.2 ? 'text-green-600' : 'text-gray-600'}`}>
                    {product.revenue > 0 ? `${((product.profit / product.revenue) * 100).toFixed(1)}%` : 'N/A'}
                  </td>
                </tr>
              ))}
              {topProductsData.length === 0 && (
                <tr>
                  <td colSpan="7" className="px-4 py-6 text-center text-gray-500">
                    {t('dashboard.noProductData')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {topProductsData.length > 0 && (
          <Pagination
            currentPage={effectiveProductsPage}
            totalPages={productsTotalPages}
            onPageChange={setProductsPage}
            pageSize={productsPageSize}
            onPageSizeChange={(size) => setProductsPageSizeAndReset(Number(size))}
            totalItems={topProductsData.length}
            pageSizeOptions={PRODUCTS_PAGE_SIZE_OPTIONS}
          />
        )}
      </div>
    </div>
  )
}

// Enhanced Metric Card Component with Sparkline
function MetricCard({ title, value, subtitle, icon: Icon, color = 'blue', small = false, change, sparklineData, invertChange = false }) {
  const colorClasses = {
    blue: 'metric-card-blue',
    green: 'metric-card-green',
    red: 'metric-card-red',
    purple: 'metric-card-purple',
    orange: 'metric-card-orange',
  }

  const colorValues = {
    blue: '#3b82f6',
    green: '#10b981',
    red: '#ef4444',
    purple: '#8b5cf6',
    orange: '#f59e0b',
  }

  const isPositiveChange = invertChange ? change < 0 : change > 0
  const changeColor = isPositiveChange ? 'text-green-600' : 'text-red-600'
  const ChangeIcon = isPositiveChange ? ArrowUpRight : ArrowDownRight

  return (
    <div className={`metric-card ${colorClasses[color]}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-medium text-gray-600 mb-1">{title}</p>
          <p className={`${small ? 'text-xl' : 'text-2xl'} font-bold text-gray-900 mb-0.5`}>{value}</p>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
          
          {change !== null && change !== undefined && (
            <div className={`flex items-center gap-1 mt-2 text-sm font-medium ${changeColor}`}>
              <ChangeIcon size={16} />
              <span>{Math.abs(change).toFixed(1)}% vs prev</span>
            </div>
          )}
        </div>
        
        <div className="flex flex-col items-end gap-2">
          {Icon && (
            <div className="p-2 rounded-lg bg-gray-100">
              <Icon size={20} style={{ color: colorValues[color] }} />
            </div>
          )}
          
          {/* Mini Sparkline - LTR so chart renders correctly in Arabic/RTL */}
          {sparklineData && sparklineData.length > 0 && (
            <div dir="ltr" className="w-16 h-8">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparklineData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id={`sparkGrad-${color}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={colorValues[color]} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={colorValues[color]} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={colorValues[color]}
                    strokeWidth={1.5}
                    fill={`url(#sparkGrad-${color})`}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Dashboard
