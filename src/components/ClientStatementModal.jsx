import { useEffect, useMemo, useState } from 'react'
import Modal from './ui/Modal'
import { Printer } from './ui/Icons'
import { useLanguage } from '../context/LanguageContext'
import { getCompanySettings } from '../utils/companySettings'
import { buildStatementRows, formatStatementPeriod, getStatementClosingSummary } from '../utils/generateStatement'

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

const COLUMN_META = {
  date: { align: 'left', width: '11%' },
  type: { align: 'left', width: '16%' },
  invNumber: { align: 'center', width: '9%' },
  wht: { align: 'center', width: '7%' },
  invAmount: { align: 'right', width: '14%' },
  payment: { align: 'right', width: '14%' },
  balance: { align: 'right', width: '14%' },
  invoiceNumber: { align: 'center', width: '9%' },
  product: { align: 'left', width: '24%' },
  total: { align: 'right', width: '11%' },
  paid: { align: 'right', width: '11%' },
  remaining: { align: 'right', width: '11%' },
  dueDate: { align: 'center', width: '11%' },
  status: { align: 'left', width: '11%' },
}

function columnAlignClass(id) {
  const align = COLUMN_META[id]?.align || 'left'
  if (align === 'right') return 'text-right'
  if (align === 'center') return 'text-center'
  return 'text-left'
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
    if (!isOpen) return

    const enablePrintMode = () => document.body.classList.add('printing-statement')
    const disablePrintMode = () => document.body.classList.remove('printing-statement')

    window.addEventListener('beforeprint', enablePrintMode)
    window.addEventListener('afterprint', disablePrintMode)

    return () => {
      window.removeEventListener('beforeprint', enablePrintMode)
      window.removeEventListener('afterprint', disablePrintMode)
      disablePrintMode()
    }
  }, [isOpen])

  const handlePrint = () => {
    window.print()
  }

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
    if (type === 'accountPayment') return t('entities.statementTypeAccountPayment')
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

  const closingSummary =
    viewMode === 'ledger' && ledgerRows.length > 0
      ? getStatementClosingSummary(ledgerRows)
      : null

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
  const companyContactLines = [
    company.companyAddress,
    company.companyPhone,
    company.companyEmail,
  ].filter(Boolean)
  const clientAddress = client?.address?.trim() || ''
  const clientContact = client?.contact_info?.trim() || ''

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
      size="xl"
      footer={
        <div className="flex flex-wrap gap-2 justify-end w-full statement-controls">
          <button type="button" onClick={onClose} className="btn btn-secondary py-1.5 px-3 text-sm">
            {t('common.close')}
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={rows.length === 0}
            className="btn btn-primary flex items-center gap-2 py-1.5 px-3 text-sm"
          >
            <Printer size={16} />
            {t('entities.printStatement')}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="statement-controls grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-lg bg-blue-50/60 border border-blue-200 text-sm">
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

        <div className="client-statement-document max-w-3xl mx-auto bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div className="text-center border-b border-gray-300 pb-3 mb-3">
            <p className="text-sm font-bold text-gray-900">{company.companyName}</p>
            {companyContactLines.length > 0 && (
              <div className="mt-1 space-y-0.5 text-[11px] text-gray-600">
                {company.companyAddress && <p>{company.companyAddress}</p>}
                {company.companyPhone && <p>{company.companyPhone}</p>}
                {company.companyEmail && <p>{company.companyEmail}</p>}
              </div>
            )}
            {company.companyTagline && (
              <p className="text-[11px] text-gray-500 mt-1">{company.companyTagline}</p>
            )}
          </div>

          <h1 className="text-center text-sm font-bold text-gray-900 tracking-wide uppercase">
            {t('entities.statementTitle')} {company.companyName} - {clientName}
          </h1>
          <div className="border-b border-gray-400 my-2" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 text-xs">
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 items-baseline">
              <dt className="font-semibold text-gray-700 whitespace-nowrap">{t('entities.statementNumber')}:</dt>
              <dd className="text-gray-900">{statementPeriod}</dd>
              <dt className="font-semibold text-gray-700 whitespace-nowrap">{t('clientTransactions.date')}:</dt>
              <dd className="text-gray-900">{formatToday()}</dd>
            </dl>
            <dl className="sm:text-right space-y-0.5">
              <dt className="font-semibold text-gray-700">{t('entities.statementBillTo')}:</dt>
              <dd className="font-bold text-gray-900">{clientName}</dd>
              {clientAddress && <dd className="text-gray-600">{clientAddress}</dd>}
              {clientContact && <dd className="text-gray-600">{clientContact}</dd>}
            </dl>
          </div>

          {rows.length === 0 ? (
            <p className="text-center text-gray-500 py-8 text-sm">{t('entities.statementNoData')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="client-statement-table w-full text-xs border-collapse table-fixed">
                <colgroup>
                  {visibleColumnIds.map((id) => (
                    <col key={id} style={{ width: COLUMN_META[id]?.width || 'auto' }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {visibleColumnIds.map((id) => (
                      <th
                        key={id}
                        className={`px-2 py-1.5 font-semibold uppercase text-[10px] tracking-wide ${columnAlignClass(id)}`}
                      >
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
                          className={`px-2 py-1 border-t border-gray-200 tabular-nums ${columnAlignClass(id)} ${
                            id === 'product' || id === 'type' ? 'break-words' : 'whitespace-nowrap'
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
                            <td key={id} className={`px-2 py-1 tabular-nums ${columnAlignClass(id)}`}>
                              {isFirstAmount ? `${t('entities.statementTotals')}: ` : ''}{formatCurrency(totals.total)}
                            </td>
                          )
                        }
                        if (id === 'paid') {
                          return (
                            <td key={id} className={`px-2 py-1 tabular-nums text-green-800 ${columnAlignClass(id)}`}>
                              {isFirstAmount ? `${t('entities.statementTotals')}: ` : ''}{formatCurrency(totals.paid)}
                            </td>
                          )
                        }
                        if (id === 'remaining') {
                          return (
                            <td key={id} className={`px-2 py-1 tabular-nums text-red-800 ${columnAlignClass(id)}`}>
                              {isFirstAmount ? `${t('entities.statementTotals')}: ` : ''}{formatCurrency(totals.remaining)}
                            </td>
                          )
                        }
                        return (
                          <td key={id} className={`px-2 py-1 ${columnAlignClass(id)}`}>
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

          {viewMode === 'ledger' && closingSummary && ledgerColumns.balance && (
            <div className="mt-4 flex flex-col sm:flex-row sm:justify-end gap-2">
              {closingSummary.amountDue > 0 && (
                <div className="min-w-[180px] border border-gray-300 rounded px-3 py-2 bg-gray-50">
                  <div className="flex justify-between gap-4 text-xs font-bold">
                    <span>{t('entities.statementAmountDue')}</span>
                    <span className="tabular-nums text-red-800">{formatCurrency(closingSummary.amountDue)}</span>
                  </div>
                </div>
              )}
              {closingSummary.creditBalance > 0 && (
                <div className="min-w-[180px] border border-green-300 rounded px-3 py-2 bg-green-50">
                  <div className="flex justify-between gap-4 text-xs font-bold">
                    <span>{t('entities.statementCustomerCredit')}</span>
                    <span className="tabular-nums text-green-800">{formatCurrency(closingSummary.creditBalance)}</span>
                  </div>
                </div>
              )}
              {closingSummary.amountDue === 0 && closingSummary.creditBalance === 0 && (
                <div className="min-w-[180px] border border-gray-300 rounded px-3 py-2 bg-gray-50">
                  <div className="flex justify-between gap-4 text-xs font-bold">
                    <span>{t('entities.statementClosingBalance')}</span>
                    <span className="tabular-nums">{formatCurrency(0)}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
