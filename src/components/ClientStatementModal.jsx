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

function defaultColumnVisibility(columns) {
  return columns.reduce((acc, col) => ({ ...acc, [col.id]: col.default }), {})
}

function parseDate(value) {
  if (!value) return null
  const str = String(value)
  return new Date(str.includes('T') ? str : `${str}T00:00:00`)
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
}

function computeStatementSummary(ledgerRows = []) {
  let totalInvoiced = 0
  let totalPaid = 0
  for (const row of ledgerRows) {
    if (row.type === 'invoice' && row.invAmount !== '' && row.invAmount != null) {
      totalInvoiced += Number(row.invAmount)
    }
    if ((row.type === 'payment' || row.type === 'accountPayment') && row.payment !== '' && row.payment != null) {
      totalPaid += Number(row.payment)
    }
  }
  const closingBalance = ledgerRows.length > 0 ? Number(ledgerRows[ledgerRows.length - 1].balance || 0) : 0
  return {
    total: totalInvoiced,
    paid: totalPaid,
    remaining: closingBalance,
  }
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

  const [dateFrom, setDateFrom] = useState(initialDateFrom)
  const [dateTo, setDateTo] = useState(initialDateTo)
  const [openingBalance, setOpeningBalance] = useState(initialOpeningBalance)
  const [ledgerColumns, setLedgerColumns] = useState(() => defaultColumnVisibility(LEDGER_COLUMNS))

  useEffect(() => {
    if (!isOpen) return
    setDateFrom(initialDateFrom)
    setDateTo(initialDateTo)
    setOpeningBalance(initialOpeningBalance)
    setLedgerColumns(defaultColumnVisibility(LEDGER_COLUMNS))
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

  const visibleColumnIds = LEDGER_COLUMNS
    .map((col) => col.id)
    .filter((id) => ledgerColumns[id])

  const statementSummary = useMemo(
    () => computeStatementSummary(ledgerRows),
    [ledgerRows]
  )

  const toggleColumn = (id) => {
    setLedgerColumns((prev) => {
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
            disabled={ledgerRows.length === 0}
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
            </div>
            <p className="text-xs text-gray-500">{t('entities.openingBalanceHint')}</p>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">{t('entities.statementColumns')}</h3>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {LEDGER_COLUMNS.map((col) => (
                <label key={col.id} className="inline-flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!ledgerColumns[col.id]}
                    onChange={() => toggleColumn(col.id)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  {ledgerColumnLabel(col.id)}
                </label>
              ))}
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

          {ledgerRows.length === 0 ? (
            <p className="text-center text-gray-500 py-8 text-sm">{t('entities.statementNoData')}</p>
          ) : (
            <>
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
                          {ledgerColumnLabel(id)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerRows.map((row, index) => (
                      <tr key={`${row.type}-${row.date}-${index}`}>
                        {visibleColumnIds.map((id) => (
                          <td
                            key={id}
                            className={`px-2 py-1 border-t border-gray-200 tabular-nums ${columnAlignClass(id)} ${
                              id === 'type' ? 'break-words' : 'whitespace-nowrap'
                            } ${row.type === 'openingBalance' && id === 'type' ? 'font-semibold uppercase' : ''}`}
                          >
                            {renderLedgerCell(row, id)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="statement-period-summary mt-5 pt-4 border-t-2 border-gray-400">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-700 mb-3 text-center">
                  {t('entities.statementTotals')}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="text-center p-3 bg-blue-50 rounded border border-blue-200">
                    <p className="font-semibold text-gray-700">{t('clientTransactions.totalAmount')}</p>
                    <p className="text-sm font-bold tabular-nums text-gray-900 mt-1">{formatCurrency(statementSummary.total)}</p>
                  </div>
                  <div className="text-center p-3 bg-green-50 rounded border border-green-200">
                    <p className="font-semibold text-gray-700">{t('clientTransactions.paidAmount')}</p>
                    <p className="text-sm font-bold tabular-nums text-green-800 mt-1">{formatCurrency(statementSummary.paid)}</p>
                  </div>
                  <div className="text-center p-3 bg-red-50 rounded border border-red-200">
                    <p className="font-semibold text-gray-700">
                      {statementSummary.remaining < 0 ? t('entities.statementCustomerCredit') : t('clientTransactions.remainingAmount')}
                    </p>
                    <p className={`text-sm font-bold tabular-nums mt-1 ${statementSummary.remaining < 0 ? 'text-green-800' : 'text-red-800'}`}>
                      {formatCurrency(Math.abs(statementSummary.remaining))}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
