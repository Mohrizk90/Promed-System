import { describe, it, expect } from 'vitest'
import { allocatePaymentFifo, getClientAccountSummary } from './paymentAllocation'

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
