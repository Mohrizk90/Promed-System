import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { useLanguage } from '../context/LanguageContext'
import LoadingSpinner from './LoadingSpinner'
import Pagination from './ui/Pagination'
import { downloadCsv } from '../utils/exportCsv'
import { Printer, Download, Package, AlertTriangle } from './ui/Icons'

const LOW_STOCK_THRESHOLD = 5

export default function ProductInventory() {
  const [products, setProducts] = useState([])
  const [clientTx, setClientTx] = useState([])
  const [supplierTx, setSupplierTx] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState('product_name')
  const [sortDir, setSortDir] = useState('asc')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const { error: showError } = useToast()
  const { t, language } = useLanguage()

  const formatNum = (n) => (Number(n) ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  const currency = t('common.currency')
  const formatCurrency = (n) => (language === 'ar' ? formatNum(n) + ' ' + currency : currency + ' ' + formatNum(n))

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [pRes, cRes, sRes] = await Promise.all([
        supabase.from('products').select('*').order('product_name'),
        supabase.from('client_transactions').select('product_id, quantity, unit_price, total_amount'),
        supabase.from('supplier_transactions').select('product_id, quantity, unit_price, total_amount'),
      ])
      if (pRes.error) throw pRes.error
      setProducts(pRes.data || [])
      setClientTx(cRes.data || [])
      setSupplierTx(sRes.data || [])
    } catch (err) {
      showError('Error loading products: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const inventory = useMemo(() => {
    // Build maps of aggregated transaction data per product
    const clientMap = new Map()
    const supplierMap = new Map()

    clientTx.forEach((tx) => {
      const pid = tx.product_id
      if (!clientMap.has(pid)) clientMap.set(pid, { qty: 0, total: 0, count: 0 })
      const entry = clientMap.get(pid)
      entry.qty += parseInt(tx.quantity) || 0
      entry.total += parseFloat(tx.total_amount) || 0
      entry.count++
    })

    supplierTx.forEach((tx) => {
      const pid = tx.product_id
      if (!supplierMap.has(pid)) supplierMap.set(pid, { qty: 0, total: 0, count: 0 })
      const entry = supplierMap.get(pid)
      entry.qty += parseInt(tx.quantity) || 0
      entry.total += parseFloat(tx.total_amount) || 0
      entry.count++
    })

    return products.map((p) => {
      const cData = clientMap.get(p.product_id) || { qty: 0, total: 0, count: 0 }
      const sData = supplierMap.get(p.product_id) || { qty: 0, total: 0, count: 0 }
      const stockIn = sData.qty
      const stockOut = cData.qty
      const currentStock = stockIn - stockOut
      const avgBuyPrice = sData.count > 0 ? sData.total / sData.qty : 0
      const avgSellPrice = cData.count > 0 ? cData.total / cData.qty : 0
      const margin = avgSellPrice > 0 && avgBuyPrice > 0 ? ((avgSellPrice - avgBuyPrice) / avgSellPrice * 100) : 0
      const revenue = cData.total
      const cost = sData.total

      return {
        ...p,
        stockIn,
        stockOut,
        currentStock,
        avgBuyPrice,
        avgSellPrice,
        margin,
        revenue,
        cost,
        profit: revenue - cost,
      }
    })
  }, [products, clientTx, supplierTx])

  // Search filter
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return inventory
    const q = searchQuery.toLowerCase()
    return inventory.filter((p) =>
      p.product_name.toLowerCase().includes(q) || (p.model || '').toLowerCase().includes(q)
    )
  }, [inventory, searchQuery])

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let aVal = a[sortKey]
      let bVal = b[sortKey]
      if (typeof aVal === 'string') aVal = aVal.toLowerCase()
      if (typeof bVal === 'string') bVal = bVal.toLowerCase()
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [filtered, sortKey, sortDir])

  // Paginate
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const paginated = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const handleExport = () => {
    const rows = sorted.map((p) => ({
      [t('inventory.productName')]: p.product_name,
      [t('inventory.model')]: p.model || '',
      [t('inventory.avgBuyPrice')]: p.avgBuyPrice.toFixed(2),
      [t('inventory.avgSellPrice')]: p.avgSellPrice.toFixed(2),
      [t('inventory.stockIn')]: p.stockIn,
      [t('inventory.stockOut')]: p.stockOut,
      [t('inventory.currentStock')]: p.currentStock,
      [t('inventory.margin')]: p.margin.toFixed(1) + '%',
      [t('inventory.revenue')]: p.revenue.toFixed(2),
      [t('inventory.cost')]: p.cost.toFixed(2),
      [t('inventory.profit')]: p.profit.toFixed(2),
    }))
    downloadCsv('product_inventory.csv', rows)
  }

  // Summary stats
  const totalProducts = inventory.length
  const lowStockCount = inventory.filter((p) => p.currentStock > 0 && p.currentStock <= LOW_STOCK_THRESHOLD).length
  const outOfStockCount = inventory.filter((p) => p.currentStock <= 0 && (p.stockIn > 0 || p.stockOut > 0)).length
  const totalStockValue = inventory.reduce((sum, p) => sum + (p.currentStock > 0 ? p.currentStock * p.avgBuyPrice : 0), 0)

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span className="text-gray-300 ml-0.5">&#8597;</span>
    return sortDir === 'asc' ? <span className="ml-0.5">&#9650;</span> : <span className="ml-0.5">&#9660;</span>
  }

  if (loading) return <div className="flex items-center justify-center min-h-[300px]"><LoadingSpinner size="lg" /></div>

  return (
    <div className="space-y-4 pb-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{t('inventory.title')}</h2>
          <p className="text-gray-600 text-sm">{t('inventory.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="btn btn-secondary py-1.5 px-3 text-sm"><Printer size={16} /> {t('common.print')}</button>
          <button onClick={handleExport} className="btn btn-secondary py-1.5 px-3 text-sm"><Download size={16} /> {t('common.exportCsv')}</button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-4 border-l-4 border-blue-500">
          <p className="text-xs text-gray-500 font-medium">{t('inventory.totalProducts')}</p>
          <p className="text-2xl font-bold text-gray-900">{totalProducts}</p>
        </div>
        <div className="card p-4 border-l-4 border-green-500">
          <p className="text-xs text-gray-500 font-medium">{t('inventory.stockValue')}</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalStockValue)}</p>
        </div>
        <div className="card p-4 border-l-4 border-yellow-500">
          <div className="flex items-center gap-1">
            <p className="text-xs text-gray-500 font-medium">{t('inventory.lowStock')}</p>
            {lowStockCount > 0 && <AlertTriangle size={12} className="text-yellow-500" />}
          </div>
          <p className="text-2xl font-bold text-yellow-700">{lowStockCount}</p>
        </div>
        <div className="card p-4 border-l-4 border-red-500">
          <div className="flex items-center gap-1">
            <p className="text-xs text-gray-500 font-medium">{t('inventory.outOfStock')}</p>
            {outOfStockCount > 0 && <AlertTriangle size={12} className="text-red-500" />}
          </div>
          <p className="text-2xl font-bold text-red-700">{outOfStockCount}</p>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <input type="search" placeholder={t('common.searchPlaceholder')} value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1) }}
          className="input py-2 text-sm w-64 rounded-lg border-gray-300" />
        <span className="text-sm text-gray-500">{filtered.length} {t('inventory.products')}</span>
      </div>

      {/* Table */}
      <div className="bg-white shadow rounded overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-100">
            <tr>
              {[
                { key: 'product_name', label: t('inventory.productName'), align: 'left' },
                { key: 'model', label: t('inventory.model'), align: 'left' },
                { key: 'avgBuyPrice', label: t('inventory.avgBuyPrice'), align: 'right' },
                { key: 'avgSellPrice', label: t('inventory.avgSellPrice'), align: 'right' },
                { key: 'stockIn', label: t('inventory.stockIn'), align: 'right' },
                { key: 'stockOut', label: t('inventory.stockOut'), align: 'right' },
                { key: 'currentStock', label: t('inventory.currentStock'), align: 'right' },
                { key: 'margin', label: t('inventory.margin'), align: 'right' },
                { key: 'profit', label: t('inventory.profit'), align: 'right' },
              ].map((col) => (
                <th key={col.key} onClick={() => handleSort(col.key)}
                  className={`px-3 py-2 font-semibold text-gray-700 uppercase cursor-pointer hover:bg-gray-200 select-none text-${col.align}`}>
                  {col.label} <SortIcon col={col.key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {paginated.length === 0 ? (
              <tr><td colSpan="9" className="px-3 py-6 text-center text-gray-500">{t('inventory.noProducts')}</td></tr>
            ) : (
              paginated.map((p) => {
                const isLow = p.currentStock > 0 && p.currentStock <= LOW_STOCK_THRESHOLD
                const isOut = p.currentStock <= 0 && (p.stockIn > 0 || p.stockOut > 0)
                return (
                  <tr key={p.product_id} className={`hover:bg-gray-50 ${isOut ? 'bg-red-50' : isLow ? 'bg-yellow-50' : ''}`}>
                    <td className="px-3 py-2 font-medium text-gray-900">
                      <div className="flex items-center gap-1.5">
                        <Package size={14} className="text-gray-400 flex-shrink-0" />
                        {p.product_name}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{p.model || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{p.avgBuyPrice > 0 ? formatCurrency(p.avgBuyPrice) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{p.avgSellPrice > 0 ? formatCurrency(p.avgSellPrice) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-blue-700">{p.stockIn}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-purple-700">{p.stockOut}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      <span className={`${isOut ? 'text-red-700' : isLow ? 'text-yellow-700' : 'text-gray-900'}`}>
                        {p.currentStock}
                      </span>
                      {isOut && <span className="ml-1 inline-flex items-center px-1 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-semibold">{t('inventory.outOfStockBadge')}</span>}
                      {isLow && !isOut && <span className="ml-1 inline-flex items-center px-1 py-0.5 rounded bg-yellow-100 text-yellow-700 text-[10px] font-semibold">{t('inventory.lowStockBadge')}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">{p.margin > 0 ? p.margin.toFixed(1) + '%' : '—'}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${p.profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {p.revenue > 0 || p.cost > 0 ? formatCurrency(p.profit) : '—'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {sorted.length > pageSize && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          pageSize={pageSize}
          onPageSizeChange={(size) => { setPageSize(Number(size)); setCurrentPage(1) }}
          totalItems={sorted.length}
          pageSizeOptions={[10, 25, 50, 100]}
        />
      )}
    </div>
  )
}
