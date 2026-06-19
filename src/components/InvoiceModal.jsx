import { useEffect } from 'react'
import Modal from './ui/Modal'
import { Printer } from './ui/Icons'
import { useLanguage } from '../context/LanguageContext'
import { getCompanySettings } from '../utils/companySettings'
import { getInvoiceSettings } from '../utils/invoiceSettings'
import { getInvoiceLinesFromTransaction } from '../utils/invoiceLines'

function parseDate(value) {
  if (!value) return null
  const str = String(value)
  return new Date(str.includes('T') ? str : `${str}T00:00:00`)
}

function formatDate(value) {
  const d = parseDate(value)
  if (!d) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const TERMS_MAP = {
  cod: 'COD',
  net_15: 'Net 15',
  net_30: 'Net 30',
  net_60: 'Net 60',
  net_90: 'Net 90',
}

/**
 * On-screen, print-ready HTML invoice (mirrors ClientStatementModal pattern).
 * Print uses window.print() + the body.printing-invoice CSS in index.css.
 */
export default function InvoiceModal({ isOpen, onClose, transaction, payments = [] }) {
  const { t, language } = useLanguage()
  const currency = t('common.currency')
  const company = getCompanySettings()
  const invoiceSettings = getInvoiceSettings()

  useEffect(() => {
    if (!isOpen) return
    const enable = () => document.body.classList.add('printing-invoice')
    const disable = () => document.body.classList.remove('printing-invoice')
    window.addEventListener('beforeprint', enable)
    window.addEventListener('afterprint', disable)
    return () => {
      window.removeEventListener('beforeprint', enable)
      window.removeEventListener('afterprint', disable)
      disable()
    }
  }, [isOpen])

  if (!transaction) return null

  const formatCurrency = (value) => {
    const n = Number(value) || 0
    const str = n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return language === 'ar' ? `${str} ${currency}` : `${currency} ${str}`
  }

  const lines = getInvoiceLinesFromTransaction(transaction)
  const totalAmount = Number(transaction.total_amount || 0)
  const paidAmount = Number(transaction.paid_amount || 0)
  const remaining = Number(transaction.remaining_amount ?? totalAmount - paidAmount)
  const isPaid = remaining <= 0
  const dueDate = transaction.due_date
  const isOverdue = !isPaid && dueDate && parseDate(dueDate) < new Date()

  const statusLabel = isPaid
    ? t('invoices.doc_paid')
    : isOverdue
      ? t('invoices.doc_overdue')
      : t('invoices.doc_outstanding')
  const statusClass = isPaid
    ? 'bg-green-100 text-green-800 border-green-300'
    : isOverdue
      ? 'bg-red-100 text-red-800 border-red-300'
      : 'bg-amber-100 text-amber-800 border-amber-300'

  const invoiceNumber =
    transaction.invoice_number ||
    `${invoiceSettings.invoicePrefix || 'INV'}-${String(transaction.transaction_id || 0).padStart(5, '0')}`

  const entityName =
    transaction.clients?.client_name || transaction.suppliers?.supplier_name || '—'
  const entityContact =
    transaction.clients?.contact_info || transaction.suppliers?.contact_info || ''
  const entityAddress = transaction.clients?.address || transaction.suppliers?.address || ''

  const companyContact = [company.companyAddress, company.companyPhone, company.companyEmail]
    .filter(Boolean)
    .join('  ·  ')

  const termText =
    transaction.payment_terms && transaction.payment_terms !== 'none'
      ? TERMS_MAP[transaction.payment_terms] || transaction.payment_terms
      : ''

  const methodLabel = (m) => {
    const key = (m || 'cash').toLowerCase().replace(/\s/g, '')
    const map = {
      cash: t('invoices.doc_methodCash'),
      cheque: t('invoices.doc_methodCheque'),
      bank_transfer: t('invoices.doc_methodBankTransfer'),
      banktransfer: t('invoices.doc_methodBankTransfer'),
      card: t('invoices.doc_methodCard'),
    }
    return map[key] || m || t('invoices.doc_methodCash')
  }

  const handlePrint = () => window.print()

  const isAr = language === 'ar'

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('invoices.doc_title')}
      size="xl"
      footer={
        <div className="flex flex-wrap gap-2 justify-end w-full invoice-controls">
          <button type="button" onClick={onClose} className="btn btn-secondary py-1.5 px-3 text-sm">
            {t('common.close')}
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="btn btn-primary flex items-center gap-2 py-1.5 px-3 text-sm"
          >
            <Printer size={16} />
            {t('invoices.doc_print')}
          </button>
        </div>
      }
    >
      <div className="client-invoice-document mx-auto bg-white" dir={isAr ? 'rtl' : 'ltr'}>
        {/* Header */}
        <div className="invoice-header flex items-start justify-between gap-4 bg-blue-700 text-white rounded-t-lg px-6 py-5">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">{company.companyName}</h2>
            {companyContact && <p className="text-[11px] text-blue-100 mt-1">{companyContact}</p>}
            {company.companyTagline && (
              <p className="text-[11px] text-blue-200 mt-0.5">{company.companyTagline}</p>
            )}
          </div>
          <div className="text-end">
            <p className="text-lg font-bold uppercase tracking-widest">{t('invoices.doc_invoice')}</p>
            <p className="text-sm text-blue-100 mt-1">{invoiceNumber}</p>
          </div>
        </div>

        {/* Meta row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-6 py-4 border-b border-gray-200">
          <div className="rounded-md bg-gray-50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">{t('invoices.doc_invoiceNumber')}</p>
            <p className="text-sm font-semibold text-gray-900">{invoiceNumber}</p>
          </div>
          <div className="rounded-md bg-gray-50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">{t('invoices.doc_date')}</p>
            <p className="text-sm font-semibold text-gray-900">{formatDate(transaction.transaction_date)}</p>
          </div>
          <div className="rounded-md bg-gray-50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">{t('invoices.doc_dueDate')}</p>
            <p className="text-sm font-semibold text-gray-900">{dueDate ? formatDate(dueDate) : '—'}</p>
          </div>
          <div className="rounded-md bg-gray-50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">{t('invoices.doc_status')}</p>
            <span className={`inline-flex mt-0.5 px-2 py-0.5 rounded text-xs font-bold uppercase border ${statusClass}`}>
              {statusLabel}
            </span>
          </div>
        </div>

        {/* Bill to / From */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 px-6 py-4">
          <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700">{t('invoices.doc_billTo')}</p>
            <p className="text-sm font-bold text-gray-900 mt-1">{entityName}</p>
            {entityAddress && <p className="text-xs text-gray-600">{entityAddress}</p>}
            {entityContact && <p className="text-xs text-gray-600">{entityContact}</p>}
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 sm:text-end">
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{t('invoices.doc_from')}</p>
            <p className="text-sm font-bold text-gray-900 mt-1">{company.companyName}</p>
            {company.companyAddress && <p className="text-xs text-gray-600">{company.companyAddress}</p>}
            {company.companyPhone && <p className="text-xs text-gray-600">{company.companyPhone}</p>}
            {company.companyEmail && <p className="text-xs text-gray-600">{company.companyEmail}</p>}
          </div>
        </div>

        {/* Line items */}
        <div className="px-6">
          <table className="client-invoice-table w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className="px-3 py-2 text-start font-semibold text-[11px] uppercase tracking-wide">{t('invoices.doc_description')}</th>
                <th className="px-3 py-2 text-start font-semibold text-[11px] uppercase tracking-wide">{t('invoices.doc_model')}</th>
                <th className="px-3 py-2 text-center font-semibold text-[11px] uppercase tracking-wide">{t('invoices.doc_qty')}</th>
                <th className="px-3 py-2 text-end font-semibold text-[11px] uppercase tracking-wide">{t('invoices.doc_unitPrice')}</th>
                <th className="px-3 py-2 text-end font-semibold text-[11px] uppercase tracking-wide">{t('invoices.doc_amount')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-gray-500">—</td>
                </tr>
              ) : (
                lines.map((line, index) => (
                  <tr key={index}>
                    <td className="px-3 py-2 border-t border-gray-200 text-gray-900">{line.product_name || '—'}</td>
                    <td className="px-3 py-2 border-t border-gray-200 text-gray-600">{line.model || '—'}</td>
                    <td className="px-3 py-2 border-t border-gray-200 text-center tabular-nums">{line.quantity}</td>
                    <td className="px-3 py-2 border-t border-gray-200 text-end tabular-nums">{formatCurrency(line.unit_price)}</td>
                    <td className="px-3 py-2 border-t border-gray-200 text-end tabular-nums font-medium">{formatCurrency(line.line_total)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="flex justify-end px-6 py-4">
          <div className="w-full sm:w-72 rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 space-y-1.5 invoice-totals">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">{t('invoices.doc_subtotal')}</span>
              <span className="tabular-nums text-gray-900">{formatCurrency(totalAmount)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">{t('invoices.doc_paidAmount')}</span>
              <span className="tabular-nums text-green-700">- {formatCurrency(paidAmount)}</span>
            </div>
            <div className="border-t border-gray-300 my-1" />
            <div className="flex justify-between text-base font-bold">
              <span className={isPaid ? 'text-green-700' : 'text-red-700'}>{t('invoices.doc_balanceDue')}</span>
              <span className={`tabular-nums ${isPaid ? 'text-green-700' : 'text-red-700'}`}>{formatCurrency(Math.max(0, remaining))}</span>
            </div>
          </div>
        </div>

        {/* Payment history */}
        {payments.length > 0 && (
          <div className="px-6 pb-4">
            <p className="text-xs font-bold uppercase tracking-wide text-blue-700 mb-2">{t('invoices.doc_paymentHistory')}</p>
            <table className="client-invoice-table w-full text-xs border-collapse">
              <thead>
                <tr>
                  <th className="px-3 py-1.5 text-start font-semibold uppercase tracking-wide">{t('invoices.doc_date')}</th>
                  <th className="px-3 py-1.5 text-end font-semibold uppercase tracking-wide">{t('invoices.doc_amount')}</th>
                  <th className="px-3 py-1.5 text-start font-semibold uppercase tracking-wide">{t('invoices.doc_method')}</th>
                  <th className="px-3 py-1.5 text-start font-semibold uppercase tracking-wide">{t('invoices.doc_reference')}</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p, index) => (
                  <tr key={index}>
                    <td className="px-3 py-1.5 border-t border-gray-200">{formatDate(p.payment_date)}</td>
                    <td className="px-3 py-1.5 border-t border-gray-200 text-end tabular-nums">{formatCurrency(p.payment_amount ?? p.amount)}</td>
                    <td className="px-3 py-1.5 border-t border-gray-200">{methodLabel(p.payment_method)}</td>
                    <td className="px-3 py-1.5 border-t border-gray-200">{p.reference_number || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-4 text-center">
          {termText && (
            <p className="text-xs text-gray-500 mb-1">
              {t('invoices.doc_terms')}: {termText}
            </p>
          )}
          <p className="text-sm font-bold text-blue-700">{t('invoices.doc_thankYou')}</p>
          {companyContact && <p className="text-[11px] text-gray-500 mt-1">{companyContact}</p>}
          <p className="text-[10px] text-gray-400 mt-1">{t('invoices.doc_generatedBy')}</p>
        </div>
      </div>
    </Modal>
  )
}
