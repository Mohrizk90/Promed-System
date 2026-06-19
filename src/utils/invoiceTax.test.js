import { describe, it, expect } from 'vitest'
import { computeInvoiceTax, VAT_RATE, WHT_RATE_OPTIONS } from './invoiceTax'

describe('computeInvoiceTax', () => {
  it('applies 14% VAT by default with no withholding', () => {
    const r = computeInvoiceTax(1000)
    expect(r.vatRate).toBe(14)
    expect(r.vatAmount).toBe(140)
    expect(r.whtAmount).toBe(0)
    expect(r.netTotal).toBe(1140)
  })

  it('deducts 3% withholding on the subtotal', () => {
    const r = computeInvoiceTax(1000, 3)
    expect(r.vatAmount).toBe(140)
    expect(r.whtAmount).toBe(30)
    expect(r.netTotal).toBe(1110)
  })

  it('deducts 1% withholding on the subtotal', () => {
    const r = computeInvoiceTax(2000, 1)
    expect(r.vatAmount).toBe(280)
    expect(r.whtAmount).toBe(20)
    expect(r.netTotal).toBe(2260)
  })

  it('rounds to 2 decimals', () => {
    const r = computeInvoiceTax(99.99, 3)
    expect(r.vatAmount).toBe(14)
    expect(r.whtAmount).toBe(3)
    expect(r.netTotal).toBe(110.99)
  })

  it('handles zero subtotal', () => {
    const r = computeInvoiceTax(0, 3)
    expect(r.netTotal).toBe(0)
  })

  it('exposes constants', () => {
    expect(VAT_RATE).toBe(14)
    expect(WHT_RATE_OPTIONS).toEqual([0, 1, 3])
  })
})
