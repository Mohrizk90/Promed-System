import { describe, it, expect } from 'vitest'
import {
  buildLineItemsPayload,
  calcLineTotal,
  emptyInvoiceLine,
  filterInvoicesByStatus,
  getInvoiceLinesFromTransaction,
  invoicePaymentStatus,
  normalizeInvoiceLines,
} from './invoiceLines'

describe('calcLineTotal', () => {
  it('multiplies quantity and unit price', () => {
    expect(calcLineTotal(2, 10.5)).toBe(21)
  })

  it('returns 0 for invalid quantity', () => {
    expect(calcLineTotal(0, 10)).toBe(0)
  })
})

describe('buildLineItemsPayload', () => {
  it('sums primary and extra lines', () => {
    const result = buildLineItemsPayload(
      { quantity: 2, unit_price: 100 },
      [{ product_name: 'Extra', quantity: 1, unit_price: 50, line_total: '50' }]
    )
    expect(result.primaryTotal).toBe(200)
    expect(result.invoiceTotal).toBe(250)
    expect(result.extras).toHaveLength(1)
  })
})

describe('getInvoiceLinesFromTransaction', () => {
  it('returns primary line when no extras', () => {
    const lines = getInvoiceLinesFromTransaction({
      quantity: 1,
      unit_price: 10,
      total_amount: 10,
      products: { product_name: 'Widget' },
    })
    expect(lines).toHaveLength(1)
    expect(lines[0].product_name).toBe('Widget')
    expect(lines[0].line_total).toBe(10)
  })

  it('includes extra line items', () => {
    const lines = getInvoiceLinesFromTransaction({
      quantity: 1,
      unit_price: 10,
      total_amount: 30,
      products: { product_name: 'Widget' },
      line_items: [{ product_name: 'Service', quantity: 2, unit_price: 10, line_total: 20 }],
    })
    expect(lines).toHaveLength(2)
    expect(lines[1].product_name).toBe('Service')
  })
})

describe('filterInvoicesByStatus', () => {
  const rows = [
    { transaction_id: 1, status: 'not_started', invoice_number: null },
    { transaction_id: 2, status: 'invoice', invoice_number: 'INV-001' },
    { transaction_id: 3, status: 'paid', invoice_number: null, paid_amount: 0 },
  ]

  it('keeps invoice-related rows for all filter', () => {
    const filtered = filterInvoicesByStatus(rows, 'all')
    expect(filtered.map((r) => r.transaction_id)).toEqual([1, 2])
  })

  it('filters drafts', () => {
    const filtered = filterInvoicesByStatus(rows, 'draft')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].transaction_id).toBe(1)
  })
})

describe('invoicePaymentStatus', () => {
  it('detects paid issued invoice', () => {
    expect(
      invoicePaymentStatus({ invoice_number: 'INV-1', remaining_amount: 0, paid_amount: 100 })
    ).toBe('paid')
  })
})

describe('emptyInvoiceLine', () => {
  it('returns default shape', () => {
    const line = emptyInvoiceLine()
    expect(line.quantity).toBe('1')
    expect(line.product_name).toBe('')
  })
})

describe('normalizeInvoiceLines', () => {
  it('drops empty rows', () => {
    expect(normalizeInvoiceLines([{ product_name: '', quantity: 1 }])).toHaveLength(0)
    expect(normalizeInvoiceLines([{ product_name: 'A', quantity: 2, unit_price: 5 }])).toHaveLength(1)
  })
})
