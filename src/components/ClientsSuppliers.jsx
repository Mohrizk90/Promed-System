import React, { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { useLanguage } from '../context/LanguageContext'
import LoadingSpinner from './LoadingSpinner'
import Pagination from './ui/Pagination'
import { downloadCsv } from '../utils/exportCsv'

function ClientsSuppliers() {
  const [clients, setClients] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)

  const [editingClient, setEditingClient] = useState(null)
  const [editingSupplier, setEditingSupplier] = useState(null)

  const [clientForm, setClientForm] = useState({ client_name: '', contact_info: '', address: '' })
  const [supplierForm, setSupplierForm] = useState({ supplier_name: '', contact_info: '', address: '' })

  const [savingClient, setSavingClient] = useState(false)
  const [savingSupplier, setSavingSupplier] = useState(false)
  const [clientPage, setClientPage] = useState(1)
  const [clientPageSize, setClientPageSize] = useState(10)
  const [supplierPage, setSupplierPage] = useState(1)
  const [supplierPageSize, setSupplierPageSize] = useState(10)

  const { success, error: showError } = useToast()
  const { t } = useLanguage()

  const clientTotalPages = Math.max(1, Math.ceil(clients.length / clientPageSize))
  const paginatedClients = useMemo(() => {
    const start = (clientPage - 1) * clientPageSize
    return clients.slice(start, start + clientPageSize)
  }, [clients, clientPage, clientPageSize])

  const supplierTotalPages = Math.max(1, Math.ceil(suppliers.length / supplierPageSize))
  const paginatedSuppliers = useMemo(() => {
    const start = (supplierPage - 1) * supplierPageSize
    return suppliers.slice(start, start + supplierPageSize)
  }, [suppliers, supplierPage, supplierPageSize])

  useEffect(() => {
    fetchData()
  }, [])

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
  }

  const resetSupplierForm = () => {
    setEditingSupplier(null)
    setSupplierForm({ supplier_name: '', contact_info: '', address: '' })
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
  }

  const handleSupplierEditClick = (supplier) => {
    setEditingSupplier(supplier)
    setSupplierForm({
      supplier_name: supplier.supplier_name || '',
      contact_info: supplier.contact_info || '',
      address: supplier.address || ''
    })
  }

  const handleClientDelete = async (clientId) => {
    if (!window.confirm(t('clientTransactions.deleteConfirm'))) return

    try {
      const { error } = await supabase
        .from('clients')
        .delete()
        .eq('client_id', clientId)

      if (error) throw error
      success(t('entities.delete'))
      await fetchData()
    } catch (err) {
      console.error('Error deleting client:', err)
      showError('Error deleting client: ' + err.message)
    }
  }

  const handleSupplierDelete = async (supplierId) => {
    if (!window.confirm(t('supplierTransactions.deleteConfirm'))) return

    try {
      const { error } = await supabase
        .from('suppliers')
        .delete()
        .eq('supplier_id', supplierId)

      if (error) throw error
      success(t('entities.delete'))
      await fetchData()
    } catch (err) {
      console.error('Error deleting supplier:', err)
      showError('Error deleting supplier: ' + err.message)
    }
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{t('entities.title')}</h1>
        <p className="text-gray-600 text-sm">{t('entities.subtitle')}</p>
      </div>

      {loading && (
        <div className="flex justify-center py-8">
          <LoadingSpinner />
        </div>
      )}

      {!loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Clients */}
          <section className="bg-white border border-gray-200 rounded-md p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-800">{t('entities.clientsSection')}</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleExportClientsCsv}
                  className="px-3 py-1.5 text-sm bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
                >
                  {t('common.exportCsv')}
                </button>
                <button
                  type="button"
                  onClick={resetClientForm}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  {t('entities.addClient')}
                </button>
              </div>
            </div>

            <form onSubmit={handleClientSubmit} className="space-y-2 mb-4">
              <div className="grid grid-cols-1 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    {t('entities.name')}
                  </label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    value={clientForm.client_name}
                    onChange={(e) => setClientForm({ ...clientForm, client_name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    {t('entities.contactInfo')}
                  </label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    value={clientForm.contact_info}
                    onChange={(e) => setClientForm({ ...clientForm, contact_info: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    {t('entities.address')}
                  </label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    value={clientForm.address}
                    onChange={(e) => setClientForm({ ...clientForm, address: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={savingClient}
                  className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-60"
                >
                  {savingClient ? t('clientTransactions.saving') : t('entities.save')}
                </button>
                {editingClient && (
                  <button
                    type="button"
                    onClick={resetClientForm}
                    className="px-3 py-1.5 text-sm bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
                  >
                    {t('entities.cancel')}
                  </button>
                )}
              </div>
            </form>

            <div className="overflow-x-auto overflow-y-visible">
              <table className="min-w-full text-sm table-fixed">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-300 w-[20%] min-w-0">{t('entities.name')}</th>
                    <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-300 w-[30%] min-w-0">{t('entities.contactInfo')}</th>
                    <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-300 w-[35%] min-w-0">{t('entities.address')}</th>
                    <th className="px-3 py-2 text-right text-gray-700 dark:text-gray-300 w-[15%]">{t('clientTransactions.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedClients.map((client) => (
                    <tr key={client.client_id} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="table-cell-wrap px-3 py-2 text-gray-800 dark:text-gray-200" title={client.client_name}>{client.client_name}</td>
                      <td className="table-cell-wrap px-3 py-2 text-gray-800 dark:text-gray-200 whitespace-pre-wrap" title={client.contact_info || ''}>
                        {client.contact_info || ''}
                      </td>
                      <td className="table-cell-wrap px-3 py-2 text-gray-800 dark:text-gray-200 whitespace-pre-wrap" title={client.address || ''}>
                        {client.address || ''}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleClientEditClick(client)}
                          className="text-blue-700 dark:text-blue-400 text-xs mr-2"
                        >
                          {t('entities.edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleClientDelete(client.client_id)}
                          className="text-red-700 dark:text-red-400 text-xs"
                        >
                          {t('entities.delete')}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {clients.length === 0 && (
                    <tr>
                      <td colSpan="4" className="px-3 py-3 text-center text-gray-500 dark:text-gray-400 text-sm">
                        {t('entities.noClients')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {clients.length > 0 && (
              <Pagination
                currentPage={clientPage}
                totalPages={clientTotalPages}
                onPageChange={setClientPage}
                pageSize={clientPageSize}
                onPageSizeChange={(size) => {
                  setClientPageSize(size)
                  setClientPage(1)
                }}
                totalItems={clients.length}
              />
            )}
          </section>

          {/* Suppliers */}
          <section className="bg-white border border-gray-200 rounded-md p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-800">{t('entities.suppliersSection')}</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleExportSuppliersCsv}
                  className="px-3 py-1.5 text-sm bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
                >
                  {t('common.exportCsv')}
                </button>
                <button
                  type="button"
                  onClick={resetSupplierForm}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  {t('entities.addSupplier')}
                </button>
              </div>
            </div>

            <form onSubmit={handleSupplierSubmit} className="space-y-2 mb-4">
              <div className="grid grid-cols-1 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    {t('entities.name')}
                  </label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    value={supplierForm.supplier_name}
                    onChange={(e) => setSupplierForm({ ...supplierForm, supplier_name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    {t('entities.contactInfo')}
                  </label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    value={supplierForm.contact_info}
                    onChange={(e) => setSupplierForm({ ...supplierForm, contact_info: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    {t('entities.address')}
                  </label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    value={supplierForm.address}
                    onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={savingSupplier}
                  className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-60"
                >
                  {savingSupplier ? t('supplierTransactions.saving') : t('entities.save')}
                </button>
                {editingSupplier && (
                  <button
                    type="button"
                    onClick={resetSupplierForm}
                    className="px-3 py-1.5 text-sm bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
                  >
                    {t('entities.cancel')}
                  </button>
                )}
              </div>
            </form>

            <div className="overflow-x-auto overflow-y-visible">
              <table className="min-w-full text-sm table-fixed">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-300 w-[20%] min-w-0">{t('entities.name')}</th>
                    <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-300 w-[30%] min-w-0">{t('entities.contactInfo')}</th>
                    <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-300 w-[35%] min-w-0">{t('entities.address')}</th>
                    <th className="px-3 py-2 text-right text-gray-700 dark:text-gray-300 w-[15%]">{t('supplierTransactions.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedSuppliers.map((supplier) => (
                    <tr key={supplier.supplier_id} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="table-cell-wrap px-3 py-2 text-gray-800 dark:text-gray-200" title={supplier.supplier_name}>{supplier.supplier_name}</td>
                      <td className="table-cell-wrap px-3 py-2 text-gray-800 dark:text-gray-200 whitespace-pre-wrap" title={supplier.contact_info || ''}>
                        {supplier.contact_info || ''}
                      </td>
                      <td className="table-cell-wrap px-3 py-2 text-gray-800 dark:text-gray-200 whitespace-pre-wrap" title={supplier.address || ''}>
                        {supplier.address || ''}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleSupplierEditClick(supplier)}
                          className="text-blue-700 dark:text-blue-400 text-xs mr-2"
                        >
                          {t('entities.edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSupplierDelete(supplier.supplier_id)}
                          className="text-red-700 dark:text-red-400 text-xs"
                        >
                          {t('entities.delete')}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {suppliers.length === 0 && (
                    <tr>
                      <td colSpan="4" className="px-3 py-3 text-center text-gray-500 dark:text-gray-400 text-sm">
                        {t('entities.noSuppliers')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {suppliers.length > 0 && (
              <Pagination
                currentPage={supplierPage}
                totalPages={supplierTotalPages}
                onPageChange={setSupplierPage}
                pageSize={supplierPageSize}
                onPageSizeChange={(size) => {
                  setSupplierPageSize(size)
                  setSupplierPage(1)
                }}
                totalItems={suppliers.length}
              />
            )}
          </section>
        </div>
      )}
    </div>
  )
}

export default ClientsSuppliers

