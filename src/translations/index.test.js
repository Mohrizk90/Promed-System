import { describe, it, expect } from 'vitest'
import { translations } from './index'

const requiredKeys = [
  'nav.dashboard',
  'nav.clientTransactions',
  'nav.supplierTransactions',
  'nav.clientsSuppliers',
  'clientTransactions.title',
  'clientTransactions.unitPrice',
  'clientTransactions.quantity',
  'clientTransactions.total',
  'supplierTransactions.title',
  'supplierTransactions.unitPrice',
  'dashboard.title',
  'dashboard.revenueVsExpensesTrend',
  'dashboard.paymentStatusDistribution',
  'entities.addClient',
  'entities.addSupplier'
]

function getNestedValue(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj)
}

describe('translations', () => {
  it('has both en and ar locales', () => {
    expect(translations.en).toBeDefined()
    expect(translations.ar).toBeDefined()
  })

  it('en has all required keys', () => {
    requiredKeys.forEach(key => {
      const value = getNestedValue(translations.en, key)
      expect(value, `Missing en.${key}`).toBeDefined()
      expect(typeof value).toBe('string')
      expect(value.length).toBeGreaterThan(0)
    })
  })

  it('ar has all required keys', () => {
    requiredKeys.forEach(key => {
      const value = getNestedValue(translations.ar, key)
      expect(value, `Missing ar.${key}`).toBeDefined()
      expect(typeof value).toBe('string')
      expect(value.length).toBeGreaterThan(0)
    })
  })

  it('en and ar have same structure', () => {
    const enKeys = Object.keys(translations.en)
    const arKeys = Object.keys(translations.ar)
    expect(arKeys).toEqual(enKeys)
  })
})
