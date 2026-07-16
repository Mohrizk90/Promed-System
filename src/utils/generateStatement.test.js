import { describe, it, expect } from 'vitest'
import { buildStatementRows, formatStatementPeriod, getStatementClosingSummary } from './generateStatement'

describe('buildStatementRows', () => {
  const transactions = [
    { transaction_id: 1, transaction_date: '2026-01-08', invoice_number: '152', total_amount: 72320 },
    { transaction_id: 2, transaction_date: '2026-02-10', invoice_number: '154', total_amount: 33900 },
  ]

  const payments = [
    { transaction_id: 1, payment_date: '2026-01-15', payment_amount: 72320 },
    { transaction_id: 2, payment_date: '2026-02-20', payment_amount: 33900 },
  ]

  it('builds invoice and payment rows in chronological order with running balance', () => {
    const rows = buildStatementRows(transactions, payments)

    expect(rows).toHaveLength(4)
    expect(rows[0].type).toBe('invoice')
    expect(rows[0].invAmount).toBe(72320)
    expect(rows[0].balance).toBe(72320)
    expect(rows[1].type).toBe('payment')
    expect(rows[1].payment).toBe(72320)
    expect(rows[1].balance).toBe(0)
    expect(rows[2].type).toBe('invoice')
    expect(rows[2].balance).toBe(33900)
    expect(rows[3].type).toBe('payment')
    expect(rows[3].balance).toBe(0)
  })

  it('adds opening balance row when prior activity exists before dateFrom', () => {
    const unpaidTx = [
      { transaction_id: 1, transaction_date: '2026-01-08', invoice_number: '152', total_amount: 72320 },
      { transaction_id: 2, transaction_date: '2026-02-10', invoice_number: '154', total_amount: 33900 },
    ]
    const partialPayments = [
      { transaction_id: 1, payment_date: '2026-01-15', payment_amount: 5000 },
    ]

    const rows = buildStatementRows(unpaidTx, partialPayments, {
      dateFrom: '2026-02-01',
      dateTo: '2026-12-31',
    })

    expect(rows[0].type).toBe('openingBalance')
    expect(rows[0].balance).toBe(67320)
    expect(rows.filter((r) => r.type === 'invoice')).toHaveLength(1)
    expect(rows.filter((r) => r.type === 'payment')).toHaveLength(0)
  })

  it('filters rows to the selected date range', () => {
    const rows = buildStatementRows(transactions, payments, {
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
    })

    expect(rows).toHaveLength(2)
    expect(rows[0].invoiceNumber).toBe('152')
    expect(rows[1].payment).toBe(72320)
  })

  it('carries a per-client opening balance into the period', () => {
    const txs = [
      { transaction_id: 1, transaction_date: '2026-01-01', invoice_number: '1', total_amount: 1000 },
    ]
    // opening credit of 300 (client was ahead): closing = -300 + 1000 = 700
    const rows = buildStatementRows(txs, [], { openingBalance: -300 })
    expect(rows[0].type).toBe('openingBalance')
    expect(rows[0].balance).toBe(-300)
    expect(getStatementClosingSummary(rows).closingBalance).toBe(700)
  })

  it('counts an orphan payment (invoice not in set) so the balance reconciles', () => {
    const txs = [
      { transaction_id: 1, transaction_date: '2026-01-01', invoice_number: '1', total_amount: 1000 },
    ]
    const payments = [
      // payment tied to invoice 999, which is not in the statement's transaction set
      { payment_id: 5, transaction_id: 999, payment_date: '2026-02-01', payment_amount: 1002 },
    ]

    const rows = buildStatementRows(txs, payments)
    const summary = getStatementClosingSummary(rows)

    // the orphan payment appears (as an account payment) and reduces the balance
    expect(rows.find((r) => r.type === 'accountPayment')?.payment).toBe(1002)
    // closing = 1000 invoiced - 1002 paid = -2 (customer credit), not +1000
    expect(summary.closingBalance).toBe(-2)
  })

  it('shows customer credit when account payment exceeds invoices', () => {
    const txs = [
      { transaction_id: 1, transaction_date: '2026-01-01', invoice_number: '1', total_amount: 1000 },
      { transaction_id: 2, transaction_date: '2026-02-01', invoice_number: '2', total_amount: 2000 },
    ]
    const accountPayment = [
      { payment_id: 99, client_id: 1, transaction_id: null, payment_date: '2026-03-01', payment_amount: 3500 },
    ]

    const rows = buildStatementRows(txs, accountPayment)
    const summary = getStatementClosingSummary(rows)

    expect(rows.filter((r) => r.type === 'invoice')).toHaveLength(2)
    expect(rows.find((r) => r.type === 'accountPayment')?.payment).toBe(3500)
    expect(summary.creditBalance).toBe(500)
    expect(summary.amountDue).toBe(0)
  })

  it('prefers external invoice number on statement rows when set', () => {
    const txs = [
      { transaction_id: 1, transaction_date: '2026-01-08', invoice_number: '152', total_amount: 100 },
      {
        transaction_id: 2,
        transaction_date: '2026-03-01',
        invoice_number: 'INV-00010',
        external_invoice_number: '160',
        total_amount: 200,
      },
      {
        transaction_id: 3,
        transaction_date: '2026-03-15',
        invoice_number: 'INV-00011',
        total_amount: 300,
      },
    ]
    const rows = buildStatementRows(txs, [])
    const invoiceRows = rows.filter((r) => r.type === 'invoice')

    expect(invoiceRows[0].invoiceNumber).toBe('152')
    expect(invoiceRows[1].invoiceNumber).toBe('160')
    expect(invoiceRows[2].invoiceNumber).toBe('INV-00011')
  })

  it('falls back to internal invoice number when external is empty', () => {
    const txs = [
      {
        transaction_id: 1,
        transaction_date: '2026-01-08',
        invoice_number: 'INV-00005',
        external_invoice_number: '  ',
        total_amount: 50,
      },
    ]
    const rows = buildStatementRows(txs, [])
    expect(rows[0].invoiceNumber).toBe('INV-00005')
  })
})

describe('formatStatementPeriod', () => {
  it('formats a from/to period like the sample', () => {
    expect(formatStatementPeriod('2026-01-01', '2026-04-30')).toBe('1 / 2026 TO 4 / 26')
  })

  it('returns All when no dates provided', () => {
    expect(formatStatementPeriod(null, null)).toBe('All')
  })
})
