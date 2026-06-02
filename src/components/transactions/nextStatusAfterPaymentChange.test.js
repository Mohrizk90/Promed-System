import { describe, it, expect } from 'vitest'
import { nextStatusAfterPaymentChange } from './TransactionPage.jsx'

describe('nextStatusAfterPaymentChange', () => {
  it('keeps done when fully paid and previously done', () => {
    expect(nextStatusAfterPaymentChange('done', 0)).toBe('done')
  })

  it('keeps done when fully paid and previously done (negative remaining, rounding)', () => {
    expect(nextStatusAfterPaymentChange('done', -0.01)).toBe('done')
  })

  it('sets paid when fully paid and status was not done', () => {
    expect(nextStatusAfterPaymentChange('in_progress', 0)).toBe('paid')
    expect(nextStatusAfterPaymentChange('not_started', 0)).toBe('paid')
    expect(nextStatusAfterPaymentChange('invoice', 0)).toBe('paid')
    expect(nextStatusAfterPaymentChange('paused', 0)).toBe('paid')
    expect(nextStatusAfterPaymentChange('paid', 0)).toBe('paid')
    expect(nextStatusAfterPaymentChange(null, 0)).toBe('paid')
    expect(nextStatusAfterPaymentChange(undefined, 0)).toBe('paid')
  })

  it('downgrades done to in_progress when no longer fully paid', () => {
    expect(nextStatusAfterPaymentChange('done', 50)).toBe('in_progress')
  })

  it('downgrades paid to in_progress when no longer fully paid', () => {
    expect(nextStatusAfterPaymentChange('paid', 50)).toBe('in_progress')
  })

  it('preserves non-paid/done statuses when no longer fully paid', () => {
    expect(nextStatusAfterPaymentChange('not_started', 50)).toBe('not_started')
    expect(nextStatusAfterPaymentChange('in_progress', 50)).toBe('in_progress')
    expect(nextStatusAfterPaymentChange('invoice', 50)).toBe('invoice')
    expect(nextStatusAfterPaymentChange('paused', 50)).toBe('paused')
  })

  it('treats null/undefined status as not_started', () => {
    expect(nextStatusAfterPaymentChange(null, 0)).toBe('paid')
    expect(nextStatusAfterPaymentChange(undefined, 50)).toBe('not_started')
  })
})
