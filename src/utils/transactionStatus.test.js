import { describe, it, expect } from 'vitest'
import { nextStatusAfterPaymentChange } from './transactionStatus'

describe('nextStatusAfterPaymentChange', () => {
  it('marks paid when fully settled', () => {
    expect(nextStatusAfterPaymentChange('invoice', 0)).toBe('paid')
  })

  it('keeps done when fully settled', () => {
    expect(nextStatusAfterPaymentChange('done', 0)).toBe('done')
  })

  it('downgrades paid to in_progress when balance remains', () => {
    expect(nextStatusAfterPaymentChange('paid', 10)).toBe('in_progress')
  })
})
