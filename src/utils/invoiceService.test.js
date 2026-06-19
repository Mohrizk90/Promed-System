import { describe, it, expect, beforeEach } from 'vitest'
import {
  formatInvoiceNumber,
  getInvoiceSettings,
  saveInvoiceSettings,
  parseInvoiceSequence,
  syncInvoiceCounterFromNumbers,
  peekNextInvoiceNumber,
  allocateNextInvoiceNumber,
} from './invoiceSettings'
import { isDraftInvoice, isIssuedInvoice, resolveInvoiceFields } from './invoiceService'

describe('invoiceSettings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('formats invoice numbers with padding', () => {
    expect(formatInvoiceNumber('INV', 1, 5)).toBe('INV-00001')
    expect(formatInvoiceNumber('INV', 42, 5)).toBe('INV-00042')
  })

  it('allocates sequential numbers', () => {
    saveInvoiceSettings({ invoicePrefix: 'INV', nextNumber: 10, padWidth: 5 })
    expect(allocateNextInvoiceNumber()).toBe('INV-00010')
    expect(peekNextInvoiceNumber()).toBe('INV-00011')
  })

  it('parses invoice sequence from number', () => {
    expect(parseInvoiceSequence('INV-00007', 'INV')).toBe(7)
    expect(parseInvoiceSequence('OTHER-1', 'INV')).toBeNull()
  })

  it('syncs counter from existing numbers', () => {
    saveInvoiceSettings({ invoicePrefix: 'INV', nextNumber: 1, padWidth: 5 })
    syncInvoiceCounterFromNumbers(['INV-00003', 'INV-00008'])
    expect(getInvoiceSettings().nextNumber).toBe(9)
    expect(peekNextInvoiceNumber()).toBe('INV-00009')
  })
})

describe('invoiceService', () => {
  beforeEach(() => {
    localStorage.clear()
    saveInvoiceSettings({ invoicePrefix: 'INV', nextNumber: 1, padWidth: 5 })
  })

  it('detects draft vs issued', () => {
    expect(isDraftInvoice({ status: 'not_started', invoice_number: null })).toBe(true)
    expect(isIssuedInvoice({ status: 'invoice', invoice_number: 'INV-00001' })).toBe(true)
    expect(isDraftInvoice({ status: 'invoice', invoice_number: 'INV-00001' })).toBe(false)
  })

  it('issues with auto number on issue mode', () => {
    const fields = resolveInvoiceFields({
      mode: 'issue',
      formStatus: 'not_started',
      invoiceNumber: '',
      remainingAmount: 100,
    })
    expect(fields.invoice_number).toBe('INV-00001')
    expect(fields.status).toBe('invoice')
  })

  it('saves draft without number', () => {
    const fields = resolveInvoiceFields({
      mode: 'draft',
      formStatus: 'in_progress',
      invoiceNumber: '',
      remainingAmount: 100,
    })
    expect(fields.invoice_number).toBeNull()
    expect(fields.status).toBe('in_progress')
  })
})
