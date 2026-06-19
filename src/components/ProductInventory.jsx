import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { useLanguage } from '../context/LanguageContext'
import LoadingSpinner from './LoadingSpinner'
import Pagination from './ui/Pagination'
import Modal from './ui/Modal'
import ConfirmDialog from './ui/ConfirmDialog'
import { downloadCsv } from '../utils/exportCsv'
import { Printer, Download, Package, AlertTriangle, Plus, Edit, Trash2, Box } from './ui/Icons'

const LOW_STOCK_THRESHOLD = 5
const TAB_ITEMS = 'items'
const TAB_PRODUCTS = 'products'

export default function ProductInventory() {
  const [activeTab, setActiveTab] = useState(TAB_PRODUCTS)
  const [products, setProducts] = useState([])
  const [items, setItems] = useState([])
  const [clientTx, setClientTx] = useState([])
  const [supplierTx, setSupplierTx] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState('product_name')
  const [sortDir, setSortDir] = useState('asc')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [editingProduct, setEditingProduct] = useState(null)
  const [productForm, setProductForm] = useState({ product_name: '', model: '', unit_price: '', unit_cost: '', eta_item_code: '', eta_unit_type: 'EA' })
  const [savingProduct, setSavingProduct] = useState(false)
  const [showProductModal, setShowProductModal] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [itemForm, setItemForm] = useState({ name: '', quantity: '', unit_cost: '', notes: '' })
  const [savingItem, setSavingItem] = useState(false)
  const [showItemModal, setShowItemModal] = useState(false)
  const [deleteItemTarget, setDeleteItemTarget] = useState(null)
  const [deletingItem, setDeletingItem] = useState(false)
  const { success, error: showError } = useToast()
  const { t, language } = useLanguage()

  const formatNum = (n) => (Number(n) ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  const currency = t('common.currency')
  const formatCurrency = (n) => (language === 'ar' ? formatNum(n) + ' ' + currency : currency + ' ' + formatNum(n))

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [pRes, cRes, sRes, itemsRes] = await Promise.all([
        supabase.from('products').select('*').order('product_name'),
        supabase.from('client_transactions').select('product_id, quantity, unit_price, total_amount'),
        supabase.from('supplier_transactions').select('product_id, quantity, unit_price, total_amount'),
        supabase.from('inventory_items').select('*').order('name')
      ])
      if (pRes.error) throw pRes.error
      setProducts(pRes.data || [])
      setClientTx(cRes.data || [])
      setSupplierTx(sRes.data || [])
      setItems(itemsRes.error ? [] : (itemsRes.data || []))
    } catch (err) {
      showError('Error loading inventory: ' + err.message)
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  const inventory = useMemo(() => {
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
      const avgBuyPrice = sData.count > 0 ? sData.total / sData.qty : (p.unit_cost != null ? Number(p.unit_cost) : 0)
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

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return inventory
    const q = searchQuery.toLowerCase()
    return inventory.filter((p) =>
      p.product_name.toLowerCase().includes(q) || (p.model || '').toLowerCase().includes(q)
    )
  }, [inventory, searchQuery])

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

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const paginated = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items
    const q = searchQuery.toLowerCase()
    return items.filter((i) => (i.name || '').toLowerCase().includes(q))
  }, [items, searchQuery])

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const handleExport = () => {
    const rows = sorted.map((p) => ({
      [t('inventory.productName')]: p.product_name,
      [t('inventory.model')]: p.model || '',
      [t('inventory.productCost')]: p.unit_cost != null ? p.unit_cost : '',
      [t('inventory.avgBuyPrice')]: p.avgBuyPrice.toFixed(2),
      [t('inventory.avgSellPrice')]: p.avgSellPrice.toFixed(2),
      [t('inventory.stockIn')]: p.stockIn,
      [t('inventory.stockOut')]: p.stockOut,
      [t('inventory.currentStock')]: p.currentStock,
      [t('inventory.margin')]: p.margin.toFixed(1) + '%',
      [t('inventory.profit')]: p.profit.toFixed(2),
    }))
    downloadCsv('inventory_products.csv', rows)
  }

  const totalProducts = inventory.length
  const lowStockCount = inventory.filter((p) => p.currentStock > 0 && p.currentStock <= LOW_STOCK_THRESHOLD).length
  const outOfStockCount = inventory.filter((p) => p.currentStock <= 0 && (p.stockIn > 0 || p.stockOut > 0)).length
  const totalStockValue = inventory.reduce((sum, p) => sum + (p.currentStock > 0 ? p.currentStock * (p.avgBuyPrice || 0) : 0), 0)
  const totalItemsValue = items.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_cost) || 0), 0)

  const openEditProduct = (p) => {
    setEditingProduct(p)
    setProductForm({
      product_name: p.product_name || '',
      model: p.model || '',
      unit_price: p.unit_price != null ? String(p.unit_price) : '',
      unit_cost: p.unit_cost != null ? String(p.unit_cost) : '',
      eta_item_code: p.eta_item_code || '',
      eta_unit_type: p.eta_unit_type || 'EA',
    })
    setShowProductModal(true)
  }

  const handleProductSubmit = async (e) => {
    e.preventDefault()
    if (!editingProduct || !productForm.product_name.trim()) return
    const unit_price = Math.max(0, parseFloat(productForm.unit_price) || 0)
    const unit_cost = parseFloat(productForm.unit_cost)
    const unit_costVal = Number.isNaN(unit_cost) || unit_cost < 0 ? null : unit_cost
    try {
      setSavingProduct(true)
      const { error } = await supabase
        .from('products')
        .update({
          product_name: productForm.product_name.trim(),
          model: productForm.model.trim() || null,
          unit_price,
          unit_cost: unit_costVal,
          eta_item_code: productForm.eta_item_code.trim() || null,
          eta_unit_type: productForm.eta_unit_type.trim() || null,
        })
        .eq('product_id', editingProduct.product_id)
      if (error) throw error
      success(t('entities.save'))
      setShowProductModal(false)
      setEditingProduct(null)
      await fetchData()
    } catch (err) {
      showError('Error updating product: ' + err.message)
    } finally {
      setSavingProduct(false)
    }
  }

  const openAddItem = () => {
    setEditingItem(null)
    setItemForm({ name: '', quantity: '0', unit_cost: '', notes: '' })
    setShowItemModal(true)
  }

  const openEditItem = (item) => {
    setEditingItem(item)
    setItemForm({
      name: item.name || '',
      quantity: item.quantity != null ? String(item.quantity) : '0',
      unit_cost: item.unit_cost != null ? String(item.unit_cost) : '',
      notes: item.notes || '',
    })
    setShowItemModal(true)
  }

  const handleItemSubmit = async (e) => {
    e.preventDefault()
    if (!itemForm.name.trim()) return
    const quantity = Math.max(0, parseFloat(itemForm.quantity) || 0)
    const unit_cost = Math.max(0, parseFloat(itemForm.unit_cost) || 0)
    try {
      setSavingItem(true)
      if (editingItem) {
        const { error } = await supabase
          .from('inventory_items')
          .update({ name: itemForm.name.trim(), quantity, unit_cost, notes: itemForm.notes.trim() || null })
          .eq('item_id', editingItem.item_id)
        if (error) throw error
        success(t('entities.save'))
      } else {
        const { error } = await supabase
          .from('inventory_items')
          .insert([{ name: itemForm.name.trim(), quantity, unit_cost, notes: itemForm.notes.trim() || null }])
        if (error) throw error
        success(t('inventory.itemAdded'))
      }
      setShowItemModal(false)
      setEditingItem(null)
      await fetchData()
    } catch (err) {
      showError('Error saving item: ' + err.message)
    } finally {
      setSavingItem(false)
    }
  }

  const handleDeleteItemConfirm = async () => {
    if (!deleteItemTarget) return
    try {
      setDeletingItem(true)
      const { error } = await supabase.from('inventory_items').delete().eq('item_id', deleteItemTarget.item_id)
      if (error) throw error
      success(t('entities.delete'))
      setDeleteItemTarget(null)
      await fetchData()
    } catch (err) {
      showError('Error deleting item: ' + err.message)
    } finally {
      setDeletingItem(false)
    }
  }

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span className="text-gray-300 ml-0.5">&#8597;</span>
    return sortDir === 'asc' ? <span className="ml-0.5">&#9650;</span> : <span className="ml-0.5">&#9660;</span>
  }

  if (loading) return <div className="flex justify-center min-h-[300px]"><LoadingSpinner size="lg" /></div>

  return (
    <div className="space-y-4 pb-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{t('inventory.title')}</h2>
          <p className="text-gray-600 text-sm">{t('inventory.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="btn btn-secondary py-1.5 px-3 text-sm"><Printer size={16} /> {t('common.print')}</button>
          {activeTab === TAB_PRODUCTS && <button onClick={handleExport} className="btn btn-secondary py-1.5 px-3 text-sm"><Download size={16} /> {t('common.exportCsv')}</button>}
        </div>
      </div>

      {/* Tabs: Items | Products */}
      <div className="flex gap-1 border-b border-gray-200">
        <button
          type="button"
          onClick={() => { setActiveTab(TAB_ITEMS); setSearchQuery(''); setCurrentPage(1) }}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${activeTab === TAB_ITEMS ? 'bg-white border border-b-0 border-gray-200 text-gray-900 -mb-px' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Box size={16} className="inline-block mr-1.5 align-middle" />
          {t('inventory.itemsTab')}
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab(TAB_PRODUCTS); setSearchQuery(''); setCurrentPage(1) }}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${activeTab === TAB_PRODUCTS ? 'bg-white border border-b-0 border-gray-200 text-gray-900 -mb-px' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Package size={16} className="inline-block mr-1.5 align-middle" />
          {t('inventory.productsTab')}
        </button>
      </div>

      {activeTab === TAB_ITEMS && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="card p-4 border-l-4 border-teal-500">
              <p className="text-xs text-gray-500 font-medium">{t('inventory.itemsCount')}</p>
              <p className="text-2xl font-bold text-gray-900">{items.length}</p>
            </div>
            <div className="card p-4 border-l-4 border-green-500">
              <p className="text-xs text-gray-500 font-medium">{t('inventory.itemsValue')}</p>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalItemsValue)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input type="search" placeholder={t('common.searchPlaceholder')} value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value) }} className="input py-2 text-sm w-64 rounded-lg border-gray-300" />
            <button type="button" onClick={openAddItem} className="btn btn-primary py-1.5 px-3 text-sm inline-flex items-center gap-1.5">
              <Plus size={16} />
              {t('inventory.addItem')}
            </button>
            <span className="text-sm text-gray-500">{filteredItems.length} {t('inventory.items')}</span>
          </div>
          <div className="bg-white shadow rounded overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-xs">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700 uppercase">{t('inventory.itemName')}</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700 uppercase">{t('inventory.quantity')}</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700 uppercase">{t('inventory.unitCost')}</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700 uppercase">{t('inventory.value')}</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700 uppercase">{t('entities.notes')}</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700 uppercase w-24">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredItems.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">{t('inventory.noItems')}</td></tr>
                ) : (
                  filteredItems.map((item) => {
                    const qty = Number(item.quantity) || 0
                    const cost = Number(item.unit_cost) || 0
                    const value = qty * cost
                    return (
                      <tr key={item.item_id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-900">{item.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{qty}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-700">{formatCurrency(cost)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">{formatCurrency(value)}</td>
                        <td className="px-3 py-2 text-gray-600 max-w-[120px] truncate" title={item.notes || ''}>{item.notes || '—'}</td>
                        <td className="px-3 py-2 text-right">
                          <button type="button" onClick={() => openEditItem(item)} className="p-1.5 rounded text-gray-600 hover:bg-gray-100" title={t('entities.edit')}><Edit size={14} /></button>
                          <button type="button" onClick={() => setDeleteItemTarget(item)} className="p-1.5 rounded text-red-600 hover:bg-red-50" title={t('entities.delete')}><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === TAB_PRODUCTS && (
        <>
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
          <div className="flex items-center gap-3">
            <input type="search" placeholder={t('common.searchPlaceholder')} value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1) }} className="input py-2 text-sm w-64 rounded-lg border-gray-300" />
            <span className="text-sm text-gray-500">{filtered.length} {t('inventory.products')}</span>
          </div>
          <div className="bg-white shadow rounded overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-xs">
              <thead className="bg-gray-100">
                <tr>
                  {[
                    { key: 'product_name', label: t('inventory.productName'), align: 'left' },
                    { key: 'model', label: t('inventory.model'), align: 'left' },
                    { key: 'unit_cost', label: t('inventory.productCost'), align: 'right' },
                    { key: 'avgBuyPrice', label: t('inventory.avgBuyPrice'), align: 'right' },
                    { key: 'avgSellPrice', label: t('inventory.avgSellPrice'), align: 'right' },
                    { key: 'stockIn', label: t('inventory.stockIn'), align: 'right' },
                    { key: 'stockOut', label: t('inventory.stockOut'), align: 'right' },
                    { key: 'currentStock', label: t('inventory.currentStock'), align: 'right' },
                    { key: 'margin', label: t('inventory.margin'), align: 'right' },
                    { key: 'profit', label: t('inventory.profit'), align: 'right' },
                  ].map((col) => (
                    <th key={col.key} onClick={() => handleSort(col.key)} className={`px-3 py-2 font-semibold text-gray-700 uppercase cursor-pointer hover:bg-gray-200 select-none text-${col.align}`}>
                      {col.label} <SortIcon col={col.key} />
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-semibold text-gray-700 uppercase w-20">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {paginated.length === 0 ? (
                  <tr><td colSpan={11} className="px-3 py-6 text-center text-gray-500">{t('inventory.noProducts')}</td></tr>
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
                        <td className="px-3 py-2 text-right tabular-nums text-gray-700">{p.unit_cost != null && p.unit_cost > 0 ? formatCurrency(p.unit_cost) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-700">{p.avgBuyPrice > 0 ? formatCurrency(p.avgBuyPrice) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-700">{p.avgSellPrice > 0 ? formatCurrency(p.avgSellPrice) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-blue-700">{p.stockIn}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-purple-700">{p.stockOut}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                          <span className={`${isOut ? 'text-red-700' : isLow ? 'text-yellow-700' : 'text-gray-900'}`}>{p.currentStock}</span>
                          {isOut && <span className="ml-1 inline-flex px-1 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-semibold">{t('inventory.outOfStockBadge')}</span>}
                          {isLow && !isOut && <span className="ml-1 inline-flex px-1 py-0.5 rounded bg-yellow-100 text-yellow-700 text-[10px] font-semibold">{t('inventory.lowStockBadge')}</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">{p.margin > 0 ? p.margin.toFixed(1) + '%' : '—'}</td>
                        <td className={`px-3 py-2 text-right tabular-nums font-medium ${p.profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {p.revenue > 0 || p.cost > 0 ? formatCurrency(p.profit) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button type="button" onClick={() => openEditProduct(p)} className="p-1.5 rounded text-gray-600 hover:bg-gray-100" title={t('entities.edit')}><Edit size={14} /></button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          {sorted.length > pageSize && (
            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} pageSize={pageSize} onPageSizeChange={(size) => { setPageSize(Number(size)); setCurrentPage(1) }} totalItems={sorted.length} pageSizeOptions={[10, 25, 50, 100]} />
          )}
        </>
      )}

      {/* Edit product modal */}
      <Modal isOpen={showProductModal} onClose={() => { setShowProductModal(false); setEditingProduct(null) }} title={t('inventory.editProduct')} size="md" footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => { setShowProductModal(false); setEditingProduct(null) }} className="btn btn-secondary">{t('entities.cancel')}</button>
          <button type="submit" form="product-edit-form" disabled={savingProduct} className="btn btn-primary">{savingProduct ? t('clientTransactions.saving') : t('entities.save')}</button>
        </div>
      }>
        <form id="product-edit-form" onSubmit={handleProductSubmit} className="space-y-3">
          <div>
            <label className="label text-xs">{t('inventory.productName')}</label>
            <input type="text" className="input py-2 text-sm" value={productForm.product_name} onChange={(e) => setProductForm({ ...productForm, product_name: e.target.value })} required />
          </div>
          <div>
            <label className="label text-xs">{t('inventory.model')}</label>
            <input type="text" className="input py-2 text-sm" value={productForm.model} onChange={(e) => setProductForm({ ...productForm, model: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">{t('inventory.unitPrice')}</label>
            <input type="number" min="0" step="0.01" className="input py-2 text-sm" value={productForm.unit_price} onChange={(e) => setProductForm({ ...productForm, unit_price: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">{t('inventory.productCost')}</label>
            <input type="number" min="0" step="0.01" className="input py-2 text-sm" value={productForm.unit_cost} onChange={(e) => setProductForm({ ...productForm, unit_cost: e.target.value })} placeholder={t('inventory.productCostPlaceholder')} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">{t('inventory.etaItemCode')}</label>
              <input type="text" className="input py-2 text-sm" value={productForm.eta_item_code} onChange={(e) => setProductForm({ ...productForm, eta_item_code: e.target.value })} placeholder="EG-XXXXXXXXX-X" />
            </div>
            <div>
              <label className="label text-xs">{t('inventory.etaUnitType')}</label>
              <input type="text" className="input py-2 text-sm" value={productForm.eta_unit_type} onChange={(e) => setProductForm({ ...productForm, eta_unit_type: e.target.value })} placeholder="EA" list="eta-unit-types" />
              <datalist id="eta-unit-types">
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
          </div>
        </form>
      </Modal>

      {/* Add/Edit item modal */}
      <Modal isOpen={showItemModal} onClose={() => { setShowItemModal(false); setEditingItem(null) }} title={editingItem ? t('inventory.editItem') : t('inventory.addItem')} size="md" footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => { setShowItemModal(false); setEditingItem(null) }} className="btn btn-secondary">{t('entities.cancel')}</button>
          <button type="submit" form="item-form" disabled={savingItem} className="btn btn-primary">{savingItem ? t('clientTransactions.saving') : t('entities.save')}</button>
        </div>
      }>
        <form id="item-form" onSubmit={handleItemSubmit} className="space-y-3">
          <div>
            <label className="label text-xs">{t('inventory.itemName')}</label>
            <input type="text" className="input py-2 text-sm" value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} required />
          </div>
          <div>
            <label className="label text-xs">{t('inventory.quantity')}</label>
            <input type="number" min="0" step="any" className="input py-2 text-sm" value={itemForm.quantity} onChange={(e) => setItemForm({ ...itemForm, quantity: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">{t('inventory.unitCost')}</label>
            <input type="number" min="0" step="0.01" className="input py-2 text-sm" value={itemForm.unit_cost} onChange={(e) => setItemForm({ ...itemForm, unit_cost: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">{t('entities.notes')}</label>
            <textarea className="input py-2 text-sm min-h-[60px]" value={itemForm.notes} onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })} />
          </div>
        </form>
      </Modal>

      <ConfirmDialog isOpen={!!deleteItemTarget} onClose={() => setDeleteItemTarget(null)} onConfirm={handleDeleteItemConfirm} title={t('common.deleteConfirmTitle')} message={t('inventory.deleteItemConfirm')} confirmText={t('entities.delete')} cancelText={t('entities.cancel')} type="danger" loading={deletingItem} />
    </div>
  )
}
