import { describe, it, expect } from 'vitest'
import { buildStatementRows, formatStatementPeriod } from './generateStatement'

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

  it('respects explicit opening balance', () => {
    const rows = buildStatementRows([], [], { openingBalance: 1002 })

    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('openingBalance')
    expect(rows[0].invAmount).toBe(1002)
    expect(rows[0].balance).toBe(1002)
  })

  it('filters rows to the selected date range', () => {
    const rows = buildStatementRows(transactions, payments, {
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      openingBalance: 0,
    })

    expect(rows).toHaveLength(2)
    expect(rows[0].invoiceNumber).toBe('152')
    expect(rows[1].payment).toBe(72320)
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
