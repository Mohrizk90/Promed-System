import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../context/LanguageContext'
import { useToast } from '../context/ToastContext'
import LoadingSpinner from './LoadingSpinner'
import Dropdown from './ui/Dropdown'
import { FileText, MoreVertical, Plus } from './ui/Icons'
import { generateInvoice } from '../utils/generateInvoice'
import { buildInvoicePdfOptions, isDraftInvoice, isIssuedInvoice } from '../utils/invoiceService'
import { allocateNextInvoiceNumber } from '../utils/invoiceSettings'
import { nextStatusAfterPaymentChange } from '../utils/transactionStatus'
import {
  filterInvoicesByStatus,
  getInvoiceLinesFromTransaction,
  invoicePaymentStatus,
} from '../utils/invoiceLines'

const STATUS_FILTERS = ['all', 'draft', 'issued', 'unpaid', 'partial', 'paid']

export default function Invoices() {
  const { t, language } = useLanguage()
  const { success, error: showError } = useToast()
  const currency = t('common.currency')
  const [transactions, setTransactions] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  const formatCurrency = (n) => {
    const str = (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return language === 'ar' ? `${str} ${currency}` : `${currency} ${str}`
  }

  const fetchData = async () => {
    try {
      setLoading(true)
      const [txRes, payRes] = await Promise.all([
        supabase
          .from('client_transactions')
          .select(`*, clients:client_id (client_name), products:product_id (product_name, model)`)
          .order('transaction_date', { ascending: false }),
        supabase.from('payments').select('*').eq('transaction_type', 'client'),
      ])
      if (txRes.error) throw txRes.error
      if (payRes.error) throw payRes.error
      setTransactions(txRes.data || [])
      setPayments(payRes.data || [])
    } catch (err) {
      showError(err.message || 'Failed to load invoices')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const filtered = useMemo(() => {
    let rows = filterInvoicesByStatus(transactions, statusFilter)
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter((tx) => {
        const client = tx.clients?.client_name?.toLowerCase() || ''
        const inv = tx.invoice_number?.toLowerCase() || ''
        const product = tx.products?.product_name?.toLowerCase() || ''
        return client.includes(q) || inv.includes(q) || product.includes(q)
      })
    }
    return rows
  }, [transactions, statusFilter, search])

  const getPayments = (transactionId) =>
    payments.filter((p) => p.transaction_id === transactionId)

  const handlePrint = async (tx) => {
    try {
      await generateInvoice(tx, {
        ...buildInvoicePdfOptions(language, currency),
        payments: getPayments(tx.transaction_id),
      })
      success(t('invoices.printed'))
    } catch (err) {
      showError(err?.message || 'Print failed')
    }
  }

  const handleIssue = async (tx) => {
    if (!isDraftInvoice(tx)) return
    try {
      const remaining = Number(tx.remaining_amount || 0)
      const invoiceNumber = allocateNextInvoiceNumber()
      const newStatus = nextStatusAfterPaymentChange('invoice', remaining)
      const { data, error } = await supabase
        .from('client_transactions')
        .update({ invoice_number: invoiceNumber, status: newStatus })
        .eq('transaction_id', tx.transaction_id)
        .select(`*, clients:client_id (client_name), products:product_id (product_name, model)`)
        .single()
      if (error) throw error
      await generateInvoice(data, {
        ...buildInvoicePdfOptions(language, currency),
        payments: getPayments(tx.transaction_id),
      })
      success(t('clientTransactions.invoiceIssuedSuccess'))
      fetchData()
    } catch (err) {
      showError(err?.message || 'Issue failed')
    }
  }

  const statusBadge = (tx) => {
    const status = invoicePaymentStatus(tx)
    const styles = {
      draft: 'bg-amber-100 text-amber-800',
      issued: 'bg-blue-100 text-blue-800',
      unpaid: 'bg-red-100 text-red-800',
      partial: 'bg-orange-100 text-orange-800',
      paid: 'bg-green-100 text-green-800',
      legacy: 'bg-gray-100 text-gray-700',
    }
    return (
      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ${styles[status] || styles.legacy}`}>
        {t(`invoices.status_${status}`)}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t('invoices.title')}</h1>
          <p className="text-sm text-gray-600">{t('invoices.subtitle')}</p>
        </div>
        <Link
          to="/"
          className="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg text-sm"
        >
          <Plus size={18} />
          {t('clientTransactions.createInvoice')}
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {t(`invoices.filter_${key}`)}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('invoices.searchPlaceholder')}
          className="input py-2 text-sm w-full max-w-md"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-gray-700">{t('common.invoiceNumber')}</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-700">{t('clientTransactions.date')}</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-700">{t('clientTransactions.client')}</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-700">{t('invoices.lines')}</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700">{t('clientTransactions.total')}</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700">{t('clientTransactions.remaining')}</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-700">{t('common.status')}</th>
              <th className="px-3 py-2 w-12" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-gray-500">
                  {t('invoices.empty')}
                </td>
              </tr>
            ) : (
              filtered.map((tx) => {
                const lineCount = getInvoiceLinesFromTransaction(tx).length
                return (
                  <tr key={tx.transaction_id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-900">
                      {tx.invoice_number || (
                        <span className="text-amber-700 text-xs font-semibold uppercase">{t('clientTransactions.invoiceDraft')}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                      {new Date(tx.transaction_date).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-gray-900">{tx.clients?.client_name || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{lineCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(tx.total_amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-700">{formatCurrency(tx.remaining_amount)}</td>
                    <td className="px-3 py-2">{statusBadge(tx)}</td>
                    <td className="px-3 py-2">
                      <Dropdown
                        trigger={<MoreVertical size={18} />}
                        align="right"
                        items={[
                          ...(isDraftInvoice(tx)
                            ? [{ label: t('clientTransactions.issueInvoice'), icon: FileText, onClick: () => handleIssue(tx) }]
                            : []),
                          ...(isIssuedInvoice(tx)
                            ? [{ label: t('clientTransactions.printInvoice'), icon: FileText, onClick: () => handlePrint(tx) }]
                            : []),
                        ]}
                      />
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
