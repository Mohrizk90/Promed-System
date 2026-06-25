import { describe, it, expect } from 'vitest'
import { allocatePaymentFifo, getClientAccountSummary, allocateEntityInvoices } from './paymentAllocation'

describe('allocatePaymentFifo', () => {
  const invoices = [
    { transaction_id: 1, transaction_date: '2026-01-01', remaining_amount: 1000 },
    { transaction_id: 2, transaction_date: '2026-02-01', remaining_amount: 2000 },
  ]

  it('allocates oldest invoices first and leaves credit', () => {
    const { allocations, unallocatedCredit } = allocatePaymentFifo(3500, invoices)

    expect(allocations).toEqual([
      { transaction_id: 1, allocated_amount: 1000 },
      { transaction_id: 2, allocated_amount: 2000 },
    ])
    expect(unallocatedCredit).toBe(500)
  })

  it('partially pays first invoice when payment is smaller', () => {
    const { allocations, unallocatedCredit } = allocatePaymentFifo(500, invoices)

    expect(allocations).toEqual([{ transaction_id: 1, allocated_amount: 500 }])
    expect(unallocatedCredit).toBe(0)
  })
})

describe('allocateEntityInvoices', () => {
  const invoices = [
    { transaction_id: 1, transaction_date: '2026-01-01', total_amount: 1000 },
    { transaction_id: 2, transaction_date: '2026-02-01', total_amount: 2000 },
  ]

  it('spreads a single account payment across invoices oldest-first', () => {
    const payments = [
      { payment_id: 9, transaction_id: null, payment_amount: 1500 },
    ]
    const { byTransactionId, accountCredit } = allocateEntityInvoices(invoices, payments)

    expect(byTransactionId.get(1)).toEqual({ paid: 1000, remaining: 0, total: 1000 })
    expect(byTransactionId.get(2)).toEqual({ paid: 500, remaining: 1500, total: 2000 })
    expect(accountCredit).toBe(0)
  })

  it('credits direct payments first, then account payments to the rest', () => {
    const payments = [
      { payment_id: 1, transaction_id: 2, payment_amount: 2000 }, // pays invoice 2 directly
      { payment_id: 2, transaction_id: null, payment_amount: 400 }, // account -> invoice 1
    ]
    const { byTransactionId, accountCredit } = allocateEntityInvoices(invoices, payments)

    expect(byTransactionId.get(1)).toEqual({ paid: 400, remaining: 600, total: 1000 })
    expect(byTransactionId.get(2)).toEqual({ paid: 2000, remaining: 0, total: 2000 })
    expect(accountCredit).toBe(0)
  })

  it('returns leftover account money as customer credit', () => {
    const payments = [
      { payment_id: 9, transaction_id: null, payment_amount: 3500 },
    ]
    const { byTransactionId, accountCredit } = allocateEntityInvoices(invoices, payments)

    expect(byTransactionId.get(1).remaining).toBe(0)
    expect(byTransactionId.get(2).remaining).toBe(0)
    expect(accountCredit).toBe(500)
  })

  it('reflects nothing-paid as full remaining when there are no payments', () => {
    const { byTransactionId, accountCredit } = allocateEntityInvoices(invoices, [])
    expect(byTransactionId.get(1)).toEqual({ paid: 0, remaining: 1000, total: 1000 })
    expect(byTransactionId.get(2)).toEqual({ paid: 0, remaining: 2000, total: 2000 })
    expect(accountCredit).toBe(0)
  })

  it('spills direct overpayment of one invoice onto later invoices', () => {
    const payments = [
      { payment_id: 1, transaction_id: 1, payment_amount: 1500 }, // 500 overpaid on invoice 1
    ]
    const { byTransactionId, accountCredit } = allocateEntityInvoices(invoices, payments)

    expect(byTransactionId.get(1)).toEqual({ paid: 1000, remaining: 0, total: 1000 })
    expect(byTransactionId.get(2)).toEqual({ paid: 500, remaining: 1500, total: 2000 })
    expect(accountCredit).toBe(0)
  })
})

describe('getClientAccountSummary', () => {
  it('computes amount due and credit balance', () => {
    const transactions = [
      { total_amount: 1000 },
      { total_amount: 2000 },
    ]
    const payments = [{ payment_amount: 3500 }]

    const summary = getClientAccountSummary(transactions, payments)
    expect(summary.totalInvoiced).toBe(3000)
    expect(summary.totalPaid).toBe(3500)
    expect(summary.amountDue).toBe(0)
    expect(summary.creditBalance).toBe(500)
  })
})
