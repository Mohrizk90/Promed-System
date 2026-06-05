import { useEffect, useMemo, useState } from 'react'
import Modal from './ui/Modal'
import { Printer } from './ui/Icons'
import { useLanguage } from '../context/LanguageContext'
import { getCompanySettings } from '../utils/companySettings'
import { buildStatementRows, formatStatementPeriod } from '../utils/generateStatement'

export const LEDGER_COLUMNS = [
  { id: 'date', default: true },
  { id: 'type', default: true },
  { id: 'invNumber', default: true },
  { id: 'wht', default: false },
  { id: 'invAmount', default: true },
  { id: 'payment', default: true },
  { id: 'balance', default: true },
]

export const TRANSACTION_COLUMNS = [
  { id: 'date', default: true },
  { id: 'invoiceNumber', default: true },
  { id: 'product', default: true },
  { id: 'total', default: true },
  { id: 'paid', default: true },
  { id: 'remaining', default: true },
  { id: 'dueDate', default: false },
  { id: 'status', default: false },
]

function defaultColumnVisibility(columns) {
  return columns.reduce((acc, col) => ({ ...acc, [col.id]: col.default }), {})
}

function parseDate(value) {
  if (!value) return null
  const str = String(value)
  return new Date(str.includes('T') ? str : `${str}T00:00:00`)
}

function inRange(date, dateFrom, dateTo) {
  const d = parseDate(date)
  if (!d) return false
  if (dateFrom) {
    const from = parseDate(dateFrom)
    if (from && d < from) return false
  }
  if (dateTo) {
    const to = parseDate(dateTo)
    if (to && d > to) return false
  }
  return true
}

function formatTableDate(value) {
  const d = parseDate(value)
  if (!d) return '—'
  return d.toLocaleDateString('en-GB')
}

function formatToday() {
  return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function ClientStatementModal({
  isOpen,
  onClose,
  client,
  transactions = [],
  payments = [],
  initialDateFrom = '',
  initialDateTo = '',
  initialOpeningBalance = '',
}) {
  const { t, language } = useLanguage()
  const currency = t('common.currency')
  const company = getCompanySettings()

  const [viewMode, setViewMode] = useState('ledger')
  const [dateFrom, setDateFrom] = useState(initialDateFrom)
  const [dateTo, setDateTo] = useState(initialDateTo)
  const [openingBalance, setOpeningBalance] = useState(initialOpeningBalance)
  const [ledgerColumns, setLedgerColumns] = useState(() => defaultColumnVisibility(LEDGER_COLUMNS))
  const [transactionColumns, setTransactionColumns] = useState(() => defaultColumnVisibility(TRANSACTION_COLUMNS))

  useEffect(() => {
    if (!isOpen) return
    setDateFrom(initialDateFrom)
    setDateTo(initialDateTo)
    setOpeningBalance(initialOpeningBalance)
    setLedgerColumns(defaultColumnVisibility(LEDGER_COLUMNS))
    setTransactionColumns(defaultColumnVisibility(TRANSACTION_COLUMNS))
  }, [isOpen, initialDateFrom, initialDateTo, initialOpeningBalance])

  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('printing-statement')
    }
    return () => document.body.classList.remove('printing-statement')
  }, [isOpen])

  const formatCurrency = (value) => {
    if (value === '' || value == null) return ''
    const n = Number(value)
    if (Number.isNaN(n)) return '—'
    const str = n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return language === 'ar' ? `${str} ${currency}` : `${currency} ${str}`
  }

  const typeLabel = (type) => {
    if (type === 'openingBalance') return t('entities.statementOpeningBalance')
    if (type === 'invoice') return t('entities.statementTypeInvoice')
    if (type === 'payment') return t('entities.statementTypePayment')
    return type
  }

  const ledgerColumnLabel = (id) => {
    const map = {
      date: t('clientTransactions.date'),
      type: t('entities.statementColType'),
      invNumber: t('common.invoiceNumber'),
      wht: t('entities.statementColWht'),
      invAmount: t('entities.statementColInvAmount'),
      payment: t('entities.statementColPayment'),
      balance: t('entities.statementColBalance'),
    }
    return map[id] || id
  }

  const transactionColumnLabel = (id) => {
    const map = {
      date: t('clientTransactions.date'),
      invoiceNumber: t('common.invoiceNumber'),
      product: t('clientTransactions.product'),
      total: t('clientTransactions.total'),
      paid: t('clientTransactions.paid'),
      remaining: t('clientTransactions.remaining'),
      dueDate: t('common.dueDate'),
      status: t('common.status'),
    }
    return map[id] || id
  }

  const openingBalanceValue = openingBalance.trim() === '' ? undefined : Number(openingBalance)

  const ledgerRows = useMemo(
    () =>
      buildStatementRows(transactions, payments, {
        openingBalance: openingBalanceValue,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
      }),
    [transactions, payments, openingBalanceValue, dateFrom, dateTo]
  )

  const transactionRows = useMemo(
    () =>
      [...transactions]
        .filter((tx) => inRange(tx.transaction_date, dateFrom, dateTo))
        .sort((a, b) => String(a.transaction_date).localeCompare(String(b.transaction_date))),
    [transactions, dateFrom, dateTo]
  )

  const activeColumns = viewMode === 'ledger' ? ledgerColumns : transactionColumns
  const visibleColumnIds = (viewMode === 'ledger' ? LEDGER_COLUMNS : TRANSACTION_COLUMNS)
    .map((col) => col.id)
    .filter((id) => activeColumns[id])

  const closingBalance =
    viewMode === 'ledger' && ledgerRows.length > 0
      ? ledgerRows[ledgerRows.length - 1].balance
      : transactionRows.reduce((sum, tx) => sum + Number(tx.remaining_amount || 0), 0)

  const totals = useMemo(() => {
    const rows = transactionRows
    return {
      total: rows.reduce((s, tx) => s + Number(tx.total_amount || 0), 0),
      paid: rows.reduce((s, tx) => s + Number(tx.paid_amount || 0), 0),
      remaining: rows.reduce((s, tx) => s + Number(tx.remaining_amount || 0), 0),
    }
  }, [transactionRows])

  const toggleColumn = (id) => {
    const setter = viewMode === 'ledger' ? setLedgerColumns : setTransactionColumns
    setter((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      if (!Object.values(next).some(Boolean)) return prev
      return next
    })
  }

  const clientName = client?.client_name || '—'
  const statementPeriod = formatStatementPeriod(dateFrom, dateTo)

  const renderLedgerCell = (row, id) => {
    switch (id) {
      case 'date':
        return formatTableDate(row.date)
      case 'type':
        return typeLabel(row.type)
      case 'invNumber':
        return row.invoiceNumber || '—'
      case 'wht':
        return row.wht || '—'
      case 'invAmount':
        return row.invAmount !== '' ? formatCurrency(row.invAmount) : ''
      case 'payment':
        return row.payment !== '' ? formatCurrency(row.payment) : ''
      case 'balance':
        return formatCurrency(row.balance)
      default:
        return ''
    }
  }

  const renderTransactionCell = (tx, id) => {
    switch (id) {
      case 'date':
        return formatTableDate(tx.transaction_date)
      case 'invoiceNumber':
        return tx.invoice_number || '—'
      case 'product':
        return `${tx.products?.product_name || '—'}${tx.products?.model ? ` (${tx.products.model})` : ''}`
      case 'total':
        return formatCurrency(tx.total_amount)
      case 'paid':
        return formatCurrency(tx.paid_amount)
      case 'remaining':
        return formatCurrency(tx.remaining_amount)
      case 'dueDate':
        return tx.due_date ? formatTableDate(tx.due_date) : '—'
      case 'status':
        return t('common.status_' + (tx.status || 'not_started').replace(/-/g, '_'))
      default:
        return ''
    }
  }

  const rows = viewMode === 'ledger' ? ledgerRows : transactionRows

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('entities.accountStatement')}
      size="full"
      footer={
        <div className="flex flex-wrap gap-2 justify-end w-full statement-controls">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            {t('common.close')}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={rows.length === 0}
            className="btn btn-primary flex items-center gap-2"
          >
            <Printer size={18} />
            {t('entities.printStatement')}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="statement-controls grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 rounded-lg bg-blue-50/60 border border-blue-200">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">{t('entities.statementPeriod')}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="label text-xs">{t('entities.statementFrom')}</label>
                <input type="date" className="input py-2 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">{t('entities.statementTo')}</label>
                <input type="date" className="input py-2 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
              {viewMode === 'ledger' && (
                <div>
                  <label className="label text-xs">{t('entities.openingBalance')}</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input py-2 text-sm"
                    value={openingBalance}
                    onChange={(e) => setOpeningBalance(e.target.value)}
                    placeholder="Auto"
                    title={t('entities.openingBalanceHint')}
                  />
                </div>
              )}
            </div>
            {viewMode === 'ledger' && (
              <p className="text-xs text-gray-500">{t('entities.openingBalanceHint')}</p>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">{t('entities.statementLayout')}</h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setViewMode('ledger')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                  viewMode === 'ledger'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {t('entities.statementViewLedger')}
              </button>
              <button
                type="button"
                onClick={() => setViewMode('transactions')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                  viewMode === 'transactions'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {t('entities.statementViewTransactions')}
              </button>
            </div>

            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">{t('entities.statementColumns')}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {(viewMode === 'ledger' ? LEDGER_COLUMNS : TRANSACTION_COLUMNS).map((col) => (
                  <label key={col.id} className="inline-flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!activeColumns[col.id]}
                      onChange={() => toggleColumn(col.id)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    {viewMode === 'ledger' ? ledgerColumnLabel(col.id) : transactionColumnLabel(col.id)}
                  </label>
                ))}
              </div>
            </div>

            <p className="text-xs text-gray-500">{t('entities.statementPrintHint')}</p>
          </div>
        </div>

        <div className="client-statement-document bg-white border border-gray-200 rounded-lg p-6 sm:p-8 shadow-sm">
          <div className="text-center border-b border-gray-300 pb-4 mb-4">
            <p className="text-lg font-bold text-gray-900">{company.companyName}</p>
            {(company.companyAddress || company.companyPhone || company.companyEmail) && (
              <p className="text-xs text-gray-600 mt-1">
                {[company.companyAddress, company.companyPhone, company.companyEmail].filter(Boolean).join(' · ')}
              </p>
            )}
            {company.companyTagline && (
              <p className="text-xs text-gray-500 mt-0.5">{company.companyTagline}</p>
            )}
          </div>

          <h1 className="text-center text-xl font-bold text-gray-900 tracking-wide uppercase">
            {t('entities.statementTitle')} {company.companyName} - {clientName}
          </h1>
          <div className="border-b border-gray-400 my-3" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 text-sm">
            <div>
              <p><span className="font-semibold">{t('entities.statementNumber')}:</span> {statementPeriod}</p>
              <p className="mt-1"><span className="font-semibold">{t('clientTransactions.date')}:</span> {formatToday()}</p>
            </div>
            <div className="sm:text-right">
              <p className="font-semibold text-gray-700">{t('entities.statementBillTo')}</p>
              <p className="font-bold text-gray-900">{clientName}</p>
              {client?.address && <p className="text-gray-600">{client.address}</p>}
              {client?.contact_info && <p className="text-gray-600">{client.contact_info}</p>}
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="text-center text-gray-500 py-8 text-sm">{t('entities.statementNoData')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="client-statement-table min-w-full text-sm border-collapse">
                <thead>
                  <tr>
                    {visibleColumnIds.map((id) => (
                      <th key={id} className="px-3 py-2 text-left font-semibold uppercase text-xs tracking-wide">
                        {viewMode === 'ledger' ? ledgerColumnLabel(id) : transactionColumnLabel(id)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(viewMode === 'ledger' ? ledgerRows : transactionRows).map((row, index) => (
                    <tr key={viewMode === 'ledger' ? `${row.type}-${row.date}-${index}` : row.transaction_id}>
                      {visibleColumnIds.map((id) => (
                        <td
                          key={id}
                          className={`px-3 py-2 border-t border-gray-200 ${
                            ['invAmount', 'payment', 'balance', 'total', 'paid', 'remaining'].includes(id)
                              ? 'text-right tabular-nums'
                              : ''
                          } ${row.type === 'openingBalance' && id === 'type' ? 'font-semibold uppercase' : ''}`}
                        >
                          {viewMode === 'ledger' ? renderLedgerCell(row, id) : renderTransactionCell(row, id)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {viewMode === 'transactions' && ['total', 'paid', 'remaining'].some((id) => transactionColumns[id]) && (
                  <tfoot>
                    <tr className="bg-gray-100 font-semibold">
                      {visibleColumnIds.map((id, index) => {
                        const isFirstAmount = !visibleColumnIds.slice(0, index).some((c) => ['total', 'paid', 'remaining'].includes(c))
                        if (id === 'total') {
                          return (
                            <td key={id} className="px-3 py-2 text-right tabular-nums">
                              {isFirstAmount ? `${t('entities.statementTotals')}: ` : ''}{formatCurrency(totals.total)}
                            </td>
                          )
                        }
                        if (id === 'paid') {
                          return (
                            <td key={id} className="px-3 py-2 text-right tabular-nums text-green-800">
                              {isFirstAmount ? `${t('entities.statementTotals')}: ` : ''}{formatCurrency(totals.paid)}
                            </td>
                          )
                        }
                        if (id === 'remaining') {
                          return (
                            <td key={id} className="px-3 py-2 text-right tabular-nums text-red-800">
                              {isFirstAmount ? `${t('entities.statementTotals')}: ` : ''}{formatCurrency(totals.remaining)}
                            </td>
                          )
                        }
                        return (
                          <td key={id} className="px-3 py-2">
                            {index === 0 ? t('entities.statementTotals') : ''}
                          </td>
                        )
                      })}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {viewMode === 'ledger' && ledgerRows.length > 0 && ledgerColumns.balance && (
            <div className="mt-6 flex justify-end">
              <div className="min-w-[220px] border border-gray-300 rounded-lg px-4 py-3 bg-gray-50">
                <div className="flex justify-between gap-6 text-sm font-bold">
                  <span>{t('entities.statementClosingBalance')}</span>
                  <span className="tabular-nums">{formatCurrency(closingBalance)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
