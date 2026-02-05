import React, { useEffect, useState, useMemo } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { useLanguage } from '../context/LanguageContext'
import LoadingSpinner from './LoadingSpinner'
import Pagination from './ui/Pagination'
import EmptyState from './ui/EmptyState'
import ConfirmDialog from './ui/ConfirmDialog'
import Modal from './ui/Modal'
import { User, Truck, Edit, Trash2, Search, Plus, Download, Eye, ArrowLeft, Printer } from './ui/Icons'
import { downloadCsv } from '../utils/exportCsv'
import { getPaginationPrefs, setPaginationPrefs } from '../utils/paginationPrefs'

const matchSearch = (text, query) => {
  if (!query.trim()) return true
  const q = query.trim().toLowerCase()
  return (text || '').toLowerCase().includes(q)
}

function ClientsSuppliers() {
  const [clients, setClients] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)

  const [editingClient, setEditingClient] = useState(null)
  const [editingSupplier, setEditingSupplier] = useState(null)

  const [clientForm, setClientForm] = useState({ client_name: '', contact_info: '', address: '' })
  const [supplierForm, setSupplierForm] = useState({ supplier_name: '', contact_info: '', address: '' })

  const [clientSearch, setClientSearch] = useState('')
  const [supplierSearch, setSupplierSearch] = useState('')

  const [savingClient, setSavingClient] = useState(false)
  const [savingSupplier, setSavingSupplier] = useState(false)

  const [searchParams, setSearchParams] = useSearchParams()
  const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100]
  const CLIENT_ROUTE_KEY = 'entities_client'
  const SUPPLIER_ROUTE_KEY = 'entities_supplier'

  useEffect(() => {
    if (searchParams.has('clientPageSize') && searchParams.has('supplierPageSize')) return
    const clientPrefs = !searchParams.has('clientPageSize') ? getPaginationPrefs(CLIENT_ROUTE_KEY) : null
    const supplierPrefs = !searchParams.has('supplierPageSize') ? getPaginationPrefs(SUPPLIER_ROUTE_KEY) : null
    const needClient = clientPrefs && PAGE_SIZE_OPTIONS.includes(clientPrefs.pageSize)
    const needSupplier = supplierPrefs && PAGE_SIZE_OPTIONS.includes(supplierPrefs.pageSize)
    if (needClient || needSupplier) {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev)
        if (needClient) {
          p.set('clientPage', String(clientPrefs.page))
          p.set('clientPageSize', String(clientPrefs.pageSize))
        }
        if (needSupplier) {
          p.set('supplierPage', String(supplierPrefs.page))
          p.set('supplierPageSize', String(supplierPrefs.pageSize))
        }
        return p
      })
    }
  }, [])

  const clientPage = Math.max(1, parseInt(searchParams.get('clientPage'), 10) || 1)
  const clientPageSizeParam = searchParams.get('clientPageSize')
  const clientPageSize = PAGE_SIZE_OPTIONS.includes(Number(clientPageSizeParam)) ? Number(clientPageSizeParam) : 10
  const supplierPage = Math.max(1, parseInt(searchParams.get('supplierPage'), 10) || 1)
  const supplierPageSizeParam = searchParams.get('supplierPageSize')
  const supplierPageSize = PAGE_SIZE_OPTIONS.includes(Number(supplierPageSizeParam)) ? Number(supplierPageSizeParam) : 10

  const setClientPage = (page) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('clientPage', String(page))
      return p
    })
    setPaginationPrefs(CLIENT_ROUTE_KEY, { page, pageSize: clientPageSize })
  }
  const setClientPageSizeAndReset = (size) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('clientPageSize', String(size))
      p.set('clientPage', '1')
      return p
    })
    setPaginationPrefs(CLIENT_ROUTE_KEY, { page: 1, pageSize: size })
  }
  const setSupplierPage = (page) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('supplierPage', String(page))
      return p
    })
    setPaginationPrefs(SUPPLIER_ROUTE_KEY, { page, pageSize: supplierPageSize })
  }
  const setSupplierPageSizeAndReset = (size) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('supplierPageSize', String(size))
      p.set('supplierPage', '1')
      return p
    })
    setPaginationPrefs(SUPPLIER_ROUTE_KEY, { page: 1, pageSize: size })
  }

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const [detailEntity, setDetailEntity] = useState(null)
  const [detailTransactions, setDetailTransactions] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)

  const [showClientFormModal, setShowClientFormModal] = useState(false)
  const [showSupplierFormModal, setShowSupplierFormModal] = useState(false)

  const location = useLocation()
  const navigate = useNavigate()
  const pathname = location.pathname
  const currentView = pathname === '/entities/clients' ? 'clients' : pathname === '/entities/suppliers' ? 'suppliers' : 'choice'

  const { success, error: showError } = useToast()
  const { t, language } = useLanguage()
  const currency = t('common.currency')

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients
    return clients.filter(
      (c) =>
        matchSearch(c.client_name, clientSearch) ||
        matchSearch(c.contact_info, clientSearch) ||
        matchSearch(c.address, clientSearch)
    )
  }, [clients, clientSearch])

  const filteredSuppliers = useMemo(() => {
    if (!supplierSearch.trim()) return suppliers
    return suppliers.filter(
      (s) =>
        matchSearch(s.supplier_name, supplierSearch) ||
        matchSearch(s.contact_info, supplierSearch) ||
        matchSearch(s.address, supplierSearch)
    )
  }, [suppliers, supplierSearch])

  const clientTotalPages = Math.max(1, Math.ceil(filteredClients.length / clientPageSize))
  const effectiveClientPage = Math.min(clientPage, clientTotalPages)
  const paginatedClients = useMemo(() => {
    const start = (effectiveClientPage - 1) * clientPageSize
    return filteredClients.slice(start, start + clientPageSize)
  }, [filteredClients, effectiveClientPage, clientPageSize])

  const supplierTotalPages = Math.max(1, Math.ceil(filteredSuppliers.length / supplierPageSize))
  const effectiveSupplierPage = Math.min(supplierPage, supplierTotalPages)
  const paginatedSuppliers = useMemo(() => {
    const start = (effectiveSupplierPage - 1) * supplierPageSize
    return filteredSuppliers.slice(start, start + supplierPageSize)
  }, [filteredSuppliers, effectiveSupplierPage, supplierPageSize])

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    if (!detailEntity) {
      setDetailTransactions([])
      return
    }
    const fetchDetailTransactions = async () => {
      setDetailLoading(true)
      try {
        if (detailEntity.type === 'client') {
          const { data, error } = await supabase
            .from('client_transactions')
            .select(`
              *,
              products:product_id (product_name, model, unit_price)
            `)
            .eq('client_id', detailEntity.data.client_id)
            .order('transaction_date', { ascending: false })
          if (error) throw error
          setDetailTransactions(data || [])
        } else {
          const { data, error } = await supabase
            .from('supplier_transactions')
            .select(`
              *,
              products:product_id (product_name, model, unit_price)
            `)
            .eq('supplier_id', detailEntity.data.supplier_id)
            .order('transaction_date', { ascending: false })
          if (error) throw error
          setDetailTransactions(data || [])
        }
      } catch (err) {
        console.error('Error loading entity transactions:', err)
        showError('Error loading transactions: ' + err.message)
        setDetailTransactions([])
      } finally {
        setDetailLoading(false)
      }
    }
    fetchDetailTransactions()
  }, [detailEntity, showError])

  const fetchData = async () => {
    try {
      setLoading(true)
      const [clientsResult, suppliersResult] = await Promise.all([
        supabase.from('clients').select('*').order('client_name'),
        supabase.from('suppliers').select('*').order('supplier_name')
      ])

      if (clientsResult.error) throw clientsResult.error
      if (suppliersResult.error) throw suppliersResult.error

      setClients(clientsResult.data || [])
      setSuppliers(suppliersResult.data || [])
    } catch (err) {
      console.error('Error loading entities:', err)
      showError('Error loading clients and suppliers: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const resetClientForm = () => {
    setEditingClient(null)
    setClientForm({ client_name: '', contact_info: '', address: '' })
    setShowClientFormModal(false)
  }

  const resetSupplierForm = () => {
    setEditingSupplier(null)
    setSupplierForm({ supplier_name: '', contact_info: '', address: '' })
    setShowSupplierFormModal(false)
  }

  const openAddClientModal = () => {
    setEditingClient(null)
    setClientForm({ client_name: '', contact_info: '', address: '' })
    setShowClientFormModal(true)
  }

  const openAddSupplierModal = () => {
    setEditingSupplier(null)
    setSupplierForm({ supplier_name: '', contact_info: '', address: '' })
    setShowSupplierFormModal(true)
  }

  const handleClientSubmit = async (e) => {
    e.preventDefault()
    if (!clientForm.client_name.trim()) return

    try {
      setSavingClient(true)
      if (editingClient) {
        const { error } = await supabase
          .from('clients')
          .update({
            client_name: clientForm.client_name.trim(),
            contact_info: clientForm.contact_info || null,
            address: clientForm.address || null
          })
          .eq('client_id', editingClient.client_id)

        if (error) throw error
        success(t('entities.save'))
      } else {
        const { error } = await supabase
          .from('clients')
          .insert([{
            client_name: clientForm.client_name.trim(),
            contact_info: clientForm.contact_info || null,
            address: clientForm.address || null
          }])

        if (error) throw error
        success(t('entities.addClient'))
      }

      resetClientForm()
      setShowClientFormModal(false)
      await fetchData()
    } catch (err) {
      console.error('Error saving client:', err)
      showError('Error saving client: ' + err.message)
    } finally {
      setSavingClient(false)
    }
  }

  const handleSupplierSubmit = async (e) => {
    e.preventDefault()
    if (!supplierForm.supplier_name.trim()) return

    try {
      setSavingSupplier(true)
      if (editingSupplier) {
        const { error } = await supabase
          .from('suppliers')
          .update({
            supplier_name: supplierForm.supplier_name.trim(),
            contact_info: supplierForm.contact_info || null,
            address: supplierForm.address || null
          })
          .eq('supplier_id', editingSupplier.supplier_id)

        if (error) throw error
        success(t('entities.save'))
      } else {
        const { error } = await supabase
          .from('suppliers')
          .insert([{
            supplier_name: supplierForm.supplier_name.trim(),
            contact_info: supplierForm.contact_info || null,
            address: supplierForm.address || null
          }])

        if (error) throw error
        success(t('entities.addSupplier'))
      }

      resetSupplierForm()
      setShowSupplierFormModal(false)
      await fetchData()
    } catch (err) {
      console.error('Error saving supplier:', err)
      showError('Error saving supplier: ' + err.message)
    } finally {
      setSavingSupplier(false)
    }
  }

  const handleClientEditClick = (client) => {
    setEditingClient(client)
    setClientForm({
      client_name: client.client_name || '',
      contact_info: client.contact_info || '',
      address: client.address || ''
    })
    setShowClientFormModal(true)
  }

  const handleSupplierEditClick = (supplier) => {
    setEditingSupplier(supplier)
    setSupplierForm({
      supplier_name: supplier.supplier_name || '',
      contact_info: supplier.contact_info || '',
      address: supplier.address || ''
    })
    setShowSupplierFormModal(true)
  }

  useEffect(() => {
    setClientPage(1)
  }, [clientSearch])

  useEffect(() => {
    setSupplierPage(1)
  }, [supplierSearch])

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    try {
      setDeleting(true)
      if (deleteTarget.type === 'client') {
        const { error } = await supabase.from('clients').delete().eq('client_id', deleteTarget.id)
        if (error) throw error
        success(t('entities.delete'))
      } else {
        const { error } = await supabase.from('suppliers').delete().eq('supplier_id', deleteTarget.id)
        if (error) throw error
        success(t('entities.delete'))
      }
      setDeleteTarget(null)
      await fetchData()
    } catch (err) {
      console.error('Error deleting:', err)
      showError(deleteTarget.type === 'client' ? 'Error deleting client: ' + err.message : 'Error deleting supplier: ' + err.message)
    } finally {
      setDeleting(false)
    }
  }

  const handleClientDeleteClick = (client) => {
    setDeleteTarget({ type: 'client', id: client.client_id, name: client.client_name })
  }

  const handleSupplierDeleteClick = (supplier) => {
    setDeleteTarget({ type: 'supplier', id: supplier.supplier_id, name: supplier.supplier_name })
  }

  const openClientDetail = (client) => {
    setDetailEntity({ type: 'client', data: client })
  }

  const openSupplierDetail = (supplier) => {
    setDetailEntity({ type: 'supplier', data: supplier })
  }

  const closeDetail = () => setDetailEntity(null)

  const formatCurrency = (value) => {
    const n = Number(value)
    if (Number.isNaN(n)) return '—'
    const str = n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return language === 'ar' ? str + ' ' + currency : currency + ' ' + str
  }

  const handleExportClientsCsv = () => {
    if (!clients || clients.length === 0) {
      showError(t('common.noDataToExport'))
      return
    }

    const rows = clients.map((c) => ({
      [t('entities.name')]: c.client_name,
      [t('entities.contactInfo')]: c.contact_info || '',
      [t('entities.address')]: c.address || ''
    }))

    downloadCsv('clients.csv', rows)
  }

  const handleExportSuppliersCsv = () => {
    if (!suppliers || suppliers.length === 0) {
      showError(t('common.noDataToExport'))
      return
    }

    const rows = suppliers.map((s) => ({
      [t('entities.name')]: s.supplier_name,
      [t('entities.contactInfo')]: s.contact_info || '',
      [t('entities.address')]: s.address || ''
    }))

    downloadCsv('suppliers.csv', rows)
  }

  // —— Choice view: two buttons to open Clients or Suppliers page ——
  if (currentView === 'choice') {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">{t('entities.title')}</h1>
          <p className="text-gray-600 text-sm mt-1 max-w-xl">{t('entities.subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl">
          <button
            type="button"
            onClick={() => navigate('/entities/clients')}
            className="flex items-center gap-4 p-6 rounded-xl border-2 border-gray-200 bg-white hover:border-blue-300 hover:shadow-md transition-all text-left group"
          >
            <div className="w-14 h-14 rounded-xl bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-colors">
              <User size={28} className="text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">{t('entities.clientsSection')}</h2>
              <p className="text-sm text-gray-500 mt-0.5">{t('entities.viewDetails')} & {t('entities.edit')}</p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => navigate('/entities/suppliers')}
            className="flex items-center gap-4 p-6 rounded-xl border-2 border-gray-200 bg-white hover:border-purple-300 hover:shadow-md transition-all text-left group"
          >
            <div className="w-14 h-14 rounded-xl bg-purple-100 flex items-center justify-center group-hover:bg-purple-200 transition-colors">
              <Truck size={28} className="text-purple-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">{t('entities.suppliersSection')}</h2>
              <p className="text-sm text-gray-500 mt-0.5">{t('entities.viewDetails')} & {t('entities.edit')}</p>
            </div>
          </button>
        </div>
      </div>
    )
  }

  // —— Clients page ——
  if (currentView === 'clients') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <button
            type="button"
            onClick={() => navigate('/entities')}
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 text-sm font-medium w-fit"
          >
            <ArrowLeft size={18} />
            {t('entities.title')}
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><LoadingSpinner /></div>
        ) : (
          <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-blue-50 to-white border-b border-gray-200 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center">
                  <User size={20} className="text-blue-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-800">{t('entities.clientsSection')}</h2>
                  <span className="text-xs text-gray-500">{filteredClients.length} {filteredClients.length === 1 ? 'client' : 'clients'}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                <button type="button" onClick={() => window.print()} disabled={filteredClients.length === 0} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
                  <Printer size={16} />
                  {t('common.print')}
                </button>
                <button type="button" onClick={handleExportClientsCsv} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
                  <Download size={16} />
                  {t('common.exportCsv')}
                </button>
                <button type="button" onClick={openAddClientModal} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                  <Plus size={16} />
                  {t('entities.addClient')}
                </button>
              </div>
            </div>

            <div className="p-5">
              <div className="relative mb-4">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder={t('entities.searchPlaceholder')}
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  className="input py-2.5 pl-10 pr-4 text-sm w-full rounded-xl border-gray-300"
                />
              </div>

              {filteredClients.length === 0 ? (
                <EmptyState
                  icon="clients"
                  title={clients.length === 0 ? t('entities.noClients') : t('entities.noMatchingClients')}
                  description={clients.length === 0 ? t('entities.addFirstClientHint') : t('entities.tryDifferentSearch')}
                  actionLabel={clients.length === 0 ? t('entities.addClient') : undefined}
                  onAction={clients.length === 0 ? openAddClientModal : undefined}
                />
              ) : (
                <>
                  <div className="space-y-2">
                    {paginatedClients.map((client) => (
                      <div
                        key={client.client_id}
                        className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl border border-gray-200 bg-white hover:border-blue-200 hover:shadow-sm transition-all"
                      >
                        <div
                          className="flex-1 min-w-0 cursor-pointer group"
                          onClick={() => openClientDetail(client)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === 'Enter' && openClientDetail(client)}
                          aria-label={t('entities.viewDetails')}
                        >
                          <p className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors truncate" title={client.client_name}>
                            {client.client_name}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2" title={client.contact_info || client.address || ''}>
                            {[client.contact_info, client.address].filter(Boolean).join(' · ') || '—'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openClientDetail(client) }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                            title={t('entities.viewDetails')}
                          >
                            <Eye size={16} />
                            <span className="hidden sm:inline">{t('entities.viewDetails')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleClientEditClick(client) }}
                            className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
                            title={t('entities.edit')}
                            aria-label={t('entities.edit')}
                          >
                            <Edit size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleClientDeleteClick(client) }}
                            className="p-2 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                            title={t('entities.delete')}
                            aria-label={t('entities.delete')}
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <Pagination
                    currentPage={effectiveClientPage}
                    totalPages={clientTotalPages}
                    onPageChange={setClientPage}
                    pageSize={clientPageSize}
                    onPageSizeChange={(size) => setClientPageSizeAndReset(Number(size))}
                    pageSizeOptions={PAGE_SIZE_OPTIONS}
                    totalItems={filteredClients.length}
                  />
                </>
              )}
            </div>
          </section>
        )}

        {/* Client add/edit modal */}
        <Modal
          isOpen={showClientFormModal}
          onClose={() => { setShowClientFormModal(false); setEditingClient(null); setClientForm({ client_name: '', contact_info: '', address: '' }) }}
          title={editingClient ? t('entities.editingClient') : t('entities.addClient')}
          size="md"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setShowClientFormModal(false); setEditingClient(null); setClientForm({ client_name: '', contact_info: '', address: '' }) }} className="btn btn-secondary">
                {t('entities.cancel')}
              </button>
              <button type="submit" form="client-form" disabled={savingClient} className="btn btn-success">
                {savingClient ? t('clientTransactions.saving') : t('entities.save')}
              </button>
            </div>
          }
        >
          <form id="client-form" onSubmit={handleClientSubmit} className="space-y-3">
            <div>
              <label className="label text-xs">{t('entities.name')}</label>
              <input type="text" className="input py-2 text-sm" value={clientForm.client_name} onChange={(e) => setClientForm({ ...clientForm, client_name: e.target.value })} required />
            </div>
            <div>
              <label className="label text-xs">{t('entities.contactInfo')}</label>
              <input type="text" className="input py-2 text-sm" value={clientForm.contact_info} onChange={(e) => setClientForm({ ...clientForm, contact_info: e.target.value })} />
            </div>
            <div>
              <label className="label text-xs">{t('entities.address')}</label>
              <input type="text" className="input py-2 text-sm" value={clientForm.address} onChange={(e) => setClientForm({ ...clientForm, address: e.target.value })} />
            </div>
          </form>
        </Modal>

        {/* Detail modal */}
        <Modal isOpen={!!detailEntity} onClose={closeDetail} title={detailEntity ? ( <span className="flex items-center gap-2"> {detailEntity.type === 'client' ? <User size={22} className="text-blue-600 flex-shrink-0" /> : <Truck size={22} className="text-purple-600 flex-shrink-0" />} {detailEntity.type === 'client' ? detailEntity.data.client_name : detailEntity.data.supplier_name} <span className="text-sm font-normal text-gray-500">— {t('entities.transactionHistory')}</span> </span> ) : ''} size="xl" showClose={true} footer={<button type="button" onClick={closeDetail} className="btn btn-secondary">{t('common.close')}</button>}>
          {detailEntity && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">{t('entities.contactAndAddress')}</h3>
                <p className="text-sm text-gray-600"><span className="font-medium">{t('entities.contactInfo')}:</span> {detailEntity.data.contact_info || '—'}</p>
                <p className="text-sm text-gray-600 mt-1"><span className="font-medium">{t('entities.address')}:</span> {detailEntity.data.address || '—'}</p>
              </div>
              {!detailLoading && detailTransactions.length > 0 && (
                <div className="flex flex-wrap gap-4 p-3 rounded-lg bg-gray-50 border border-gray-200 text-sm">
                  <span className="font-medium text-gray-700">{detailTransactions.length} {detailTransactions.length === 1 ? 'transaction' : 'transactions'}</span>
                  <span className="text-gray-600">Total: <strong className="text-gray-900">{formatCurrency(detailTransactions.reduce((s, tx) => s + Number(tx.total_amount || 0), 0))}</strong></span>
                  <span className="text-green-700">Paid: <strong>{formatCurrency(detailTransactions.reduce((s, tx) => s + Number(tx.paid_amount || 0), 0))}</strong></span>
                  <span className="text-red-700">Remaining: <strong>{formatCurrency(detailTransactions.reduce((s, tx) => s + Number(tx.remaining_amount || 0), 0))}</strong></span>
                </div>
              )}
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t('entities.transactionHistory')}</h3>
              {detailLoading ? <div className="flex justify-center py-6"><LoadingSpinner /></div> : detailTransactions.length === 0 ? <p className="text-sm text-gray-500 dark:text-gray-400 py-4">{t('entities.noTransactionsForEntity')}</p> : (
                <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-600">
                  <table className="min-w-full text-xs divide-y divide-gray-200 dark:divide-gray-600">
                    <thead className="bg-gray-100 dark:bg-gray-700/50">
                      <tr>
                        <th className="px-2 py-1 text-left font-semibold text-gray-700 dark:text-gray-200 uppercase w-20">{detailEntity.type === 'client' ? t('clientTransactions.date') : t('supplierTransactions.date')}</th>
                        <th className="px-2 py-1 text-left font-semibold text-gray-700 dark:text-gray-200 uppercase min-w-0">{detailEntity.type === 'client' ? t('clientTransactions.product') : t('supplierTransactions.product')}</th>
                        <th className="px-2 py-1 text-right font-semibold text-gray-700 dark:text-gray-200 uppercase w-14">{t('clientTransactions.quantity')}</th>
                        <th className="px-2 py-1 text-right font-semibold text-gray-700 dark:text-gray-200 uppercase w-20">{detailEntity.type === 'client' ? t('clientTransactions.unitPrice') : t('supplierTransactions.unitPrice')}</th>
                        <th className="px-2 py-1 text-right font-semibold text-gray-700 dark:text-gray-200 uppercase w-20">{t('clientTransactions.total')}</th>
                        <th className="px-2 py-1 text-right font-semibold text-gray-700 dark:text-gray-200 uppercase w-20">{t('clientTransactions.paid')}</th>
                        <th className="px-2 py-1 text-right font-semibold text-gray-700 dark:text-gray-200 uppercase w-20">{t('clientTransactions.remaining')}</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-600">
                      {detailTransactions.map((tx) => (
                        <tr key={tx.transaction_id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="px-2 py-1 text-gray-700 dark:text-gray-300 whitespace-nowrap">{tx.transaction_date}</td>
                          <td className="px-2 py-1 text-gray-800 dark:text-white max-w-[140px] truncate" title={tx.products?.product_name || '—'}>{tx.products?.product_name || '—'}{tx.products?.model ? ` (${tx.products.model})` : ''}</td>
                          <td className="px-2 py-1 text-right text-gray-700 dark:text-gray-300">{tx.quantity}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-gray-700 dark:text-gray-300">{formatCurrency(tx.unit_price)}</td>
                          <td className="px-2 py-1 text-right tabular-nums font-medium text-gray-900 dark:text-white">{formatCurrency(tx.total_amount)}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-green-700 dark:text-green-400">{formatCurrency(tx.paid_amount)}</td>
                          <td className="px-2 py-1 text-right tabular-nums font-medium text-red-700 dark:text-red-400">{formatCurrency(tx.remaining_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </Modal>

        <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDeleteConfirm} title={t('common.deleteConfirmTitle')} message={deleteTarget?.type === 'client' ? t('entities.deleteClientConfirm') : t('entities.deleteSupplierConfirm')} confirmText={t('entities.delete')} cancelText={t('entities.cancel')} type="danger" loading={deleting} />
      </div>
    )
  }

  // —— Suppliers page ——
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <button type="button" onClick={() => navigate('/entities')} className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 text-sm font-medium w-fit">
          <ArrowLeft size={18} />
          {t('entities.title')}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><LoadingSpinner /></div>
      ) : (
        <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-purple-50 to-white border-b border-gray-200 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center">
                <Truck size={20} className="text-purple-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-800">{t('entities.suppliersSection')}</h2>
                <span className="text-xs text-gray-500">{filteredSuppliers.length} {filteredSuppliers.length === 1 ? 'supplier' : 'suppliers'}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <button type="button" onClick={() => window.print()} disabled={filteredSuppliers.length === 0} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
                <Printer size={16} />
                {t('common.print')}
              </button>
              <button type="button" onClick={handleExportSuppliersCsv} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
                <Download size={16} />
                {t('common.exportCsv')}
              </button>
              <button type="button" onClick={openAddSupplierModal} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">
                <Plus size={16} />
                {t('entities.addSupplier')}
              </button>
            </div>
          </div>

          <div className="p-5">
            <div className="relative mb-4">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input type="text" placeholder={t('entities.searchPlaceholder')} value={supplierSearch} onChange={(e) => setSupplierSearch(e.target.value)} className="input py-2.5 pl-10 pr-4 text-sm w-full rounded-xl border-gray-300" />
            </div>

            {filteredSuppliers.length === 0 ? (
              <EmptyState icon="suppliers" title={suppliers.length === 0 ? t('entities.noSuppliers') : t('entities.noMatchingSuppliers')} description={suppliers.length === 0 ? t('entities.addFirstSupplierHint') : t('entities.tryDifferentSearch')} actionLabel={suppliers.length === 0 ? t('entities.addSupplier') : undefined} onAction={suppliers.length === 0 ? openAddSupplierModal : undefined} />
            ) : (
              <>
                <div className="space-y-2">
                  {paginatedSuppliers.map((supplier) => (
                    <div key={supplier.supplier_id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl border border-gray-200 bg-white hover:border-purple-200 hover:shadow-sm transition-all">
                      <div className="flex-1 min-w-0 cursor-pointer group" onClick={() => openSupplierDetail(supplier)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openSupplierDetail(supplier)} aria-label={t('entities.viewDetails')}>
                        <p className="font-semibold text-gray-900 group-hover:text-purple-600 transition-colors truncate" title={supplier.supplier_name}>{supplier.supplier_name}</p>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2" title={supplier.contact_info || supplier.address || ''}>{[supplier.contact_info, supplier.address].filter(Boolean).join(' · ') || '—'}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button type="button" onClick={(e) => { e.stopPropagation(); openSupplierDetail(supplier) }} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-purple-600 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors" title={t('entities.viewDetails')}>
                          <Eye size={16} />
                          <span className="hidden sm:inline">{t('entities.viewDetails')}</span>
                        </button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleSupplierEditClick(supplier) }} className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors" title={t('entities.edit')} aria-label={t('entities.edit')}><Edit size={18} /></button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleSupplierDeleteClick(supplier) }} className="p-2 rounded-lg text-red-600 hover:bg-red-50 transition-colors" title={t('entities.delete')} aria-label={t('entities.delete')}><Trash2 size={18} /></button>
                      </div>
                    </div>
                  ))}
                </div>
                <Pagination currentPage={effectiveSupplierPage} totalPages={supplierTotalPages} onPageChange={setSupplierPage} pageSize={supplierPageSize} onPageSizeChange={(size) => setSupplierPageSizeAndReset(Number(size))} totalItems={filteredSuppliers.length} pageSizeOptions={PAGE_SIZE_OPTIONS} />
              </>
            )}
          </div>
        </section>
      )}

      {/* Supplier add/edit modal */}
      <Modal isOpen={showSupplierFormModal} onClose={() => { setShowSupplierFormModal(false); setEditingSupplier(null); setSupplierForm({ supplier_name: '', contact_info: '', address: '' }) }} title={editingSupplier ? t('entities.editingSupplier') : t('entities.addSupplier')} size="md" footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => { setShowSupplierFormModal(false); setEditingSupplier(null); setSupplierForm({ supplier_name: '', contact_info: '', address: '' }) }} className="btn btn-secondary">{t('entities.cancel')}</button>
          <button type="submit" form="supplier-form" disabled={savingSupplier} className="btn btn-success">{savingSupplier ? t('supplierTransactions.saving') : t('entities.save')}</button>
        </div>
      }>
        <form id="supplier-form" onSubmit={handleSupplierSubmit} className="space-y-3">
          <div>
            <label className="label text-xs">{t('entities.name')}</label>
            <input type="text" className="input py-2 text-sm" value={supplierForm.supplier_name} onChange={(e) => setSupplierForm({ ...supplierForm, supplier_name: e.target.value })} required />
          </div>
          <div>
            <label className="label text-xs">{t('entities.contactInfo')}</label>
            <input type="text" className="input py-2 text-sm" value={supplierForm.contact_info} onChange={(e) => setSupplierForm({ ...supplierForm, contact_info: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">{t('entities.address')}</label>
            <input type="text" className="input py-2 text-sm" value={supplierForm.address} onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })} />
          </div>
        </form>
      </Modal>

      {/* Detail modal (same as clients) */}
      <Modal isOpen={!!detailEntity} onClose={closeDetail} title={detailEntity ? ( <span className="flex items-center gap-2"> {detailEntity.type === 'client' ? <User size={22} className="text-blue-600 flex-shrink-0" /> : <Truck size={22} className="text-purple-600 flex-shrink-0" />} {detailEntity.type === 'client' ? detailEntity.data.client_name : detailEntity.data.supplier_name} <span className="text-sm font-normal text-gray-500">— {t('entities.transactionHistory')}</span> </span> ) : ''} size="xl" showClose={true} footer={<button type="button" onClick={closeDetail} className="btn btn-secondary">{t('common.close')}</button>}>
        {detailEntity && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">{t('entities.contactAndAddress')}</h3>
              <p className="text-sm text-gray-600"><span className="font-medium">{t('entities.contactInfo')}:</span> {detailEntity.data.contact_info || '—'}</p>
              <p className="text-sm text-gray-600 mt-1"><span className="font-medium">{t('entities.address')}:</span> {detailEntity.data.address || '—'}</p>
            </div>
            {!detailLoading && detailTransactions.length > 0 && (
              <div className="flex flex-wrap gap-4 p-3 rounded-lg bg-gray-50 border border-gray-200 text-sm">
                <span className="font-medium text-gray-700">{detailTransactions.length} {detailTransactions.length === 1 ? 'transaction' : 'transactions'}</span>
                <span className="text-gray-600">Total: <strong className="text-gray-900">{formatCurrency(detailTransactions.reduce((s, tx) => s + Number(tx.total_amount || 0), 0))}</strong></span>
                <span className="text-green-700">Paid: <strong>{formatCurrency(detailTransactions.reduce((s, tx) => s + Number(tx.paid_amount || 0), 0))}</strong></span>
                <span className="text-red-700">Remaining: <strong>{formatCurrency(detailTransactions.reduce((s, tx) => s + Number(tx.remaining_amount || 0), 0))}</strong></span>
              </div>
            )}
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t('entities.transactionHistory')}</h3>
            {detailLoading ? <div className="flex justify-center py-6"><LoadingSpinner /></div> : detailTransactions.length === 0 ? <p className="text-sm text-gray-500 dark:text-gray-400 py-4">{t('entities.noTransactionsForEntity')}</p> : (
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-600">
                <table className="min-w-full text-xs divide-y divide-gray-200 dark:divide-gray-600">
                  <thead className="bg-gray-100 dark:bg-gray-700/50">
                    <tr>
                      <th className="px-2 py-1 text-left font-semibold text-gray-700 dark:text-gray-200 uppercase w-20">{detailEntity.type === 'client' ? t('clientTransactions.date') : t('supplierTransactions.date')}</th>
                      <th className="px-2 py-1 text-left font-semibold text-gray-700 dark:text-gray-200 uppercase min-w-0">{detailEntity.type === 'client' ? t('clientTransactions.product') : t('supplierTransactions.product')}</th>
                      <th className="px-2 py-1 text-right font-semibold text-gray-700 dark:text-gray-200 uppercase w-14">{t('clientTransactions.quantity')}</th>
                      <th className="px-2 py-1 text-right font-semibold text-gray-700 dark:text-gray-200 uppercase w-20">{detailEntity.type === 'client' ? t('clientTransactions.unitPrice') : t('supplierTransactions.unitPrice')}</th>
                      <th className="px-2 py-1 text-right font-semibold text-gray-700 dark:text-gray-200 uppercase w-20">{t('clientTransactions.total')}</th>
                      <th className="px-2 py-1 text-right font-semibold text-gray-700 dark:text-gray-200 uppercase w-20">{t('clientTransactions.paid')}</th>
                      <th className="px-2 py-1 text-right font-semibold text-gray-700 dark:text-gray-200 uppercase w-20">{t('clientTransactions.remaining')}</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-600">
                    {detailTransactions.map((tx) => (
                      <tr key={tx.transaction_id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-2 py-1 text-gray-700 dark:text-gray-300 whitespace-nowrap">{tx.transaction_date}</td>
                        <td className="px-2 py-1 text-gray-800 dark:text-white max-w-[140px] truncate" title={tx.products?.product_name || '—'}>{tx.products?.product_name || '—'}{tx.products?.model ? ` (${tx.products.model})` : ''}</td>
                        <td className="px-2 py-1 text-right text-gray-700 dark:text-gray-300">{tx.quantity}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-gray-700 dark:text-gray-300">{formatCurrency(tx.unit_price)}</td>
                        <td className="px-2 py-1 text-right tabular-nums font-medium text-gray-900 dark:text-white">{formatCurrency(tx.total_amount)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-green-700 dark:text-green-400">{formatCurrency(tx.paid_amount)}</td>
                        <td className="px-2 py-1 text-right tabular-nums font-medium text-red-700 dark:text-red-400">{formatCurrency(tx.remaining_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDeleteConfirm} title={t('common.deleteConfirmTitle')} message={deleteTarget?.type === 'client' ? t('entities.deleteClientConfirm') : t('entities.deleteSupplierConfirm')} confirmText={t('entities.delete')} cancelText={t('entities.cancel')} type="danger" loading={deleting} />
    </div>
  )
}

export default ClientsSuppliers

