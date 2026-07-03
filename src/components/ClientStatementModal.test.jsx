import { describe, expect, it } from 'vitest'

import { computeStatementSummary } from './ClientStatementModal'

describe('computeStatementSummary', () => {
  it('includes opening credit in the paid amount', () => {
    const summary = computeStatementSummary(
      [{ total_amount: 1000 }],
      [{ payment_amount: 200 }],
      -300
    )

    expect(summary).toEqual({
      total: 1000,
      paid: 500,
      remaining: 500,
    })
  })

  it('does not count opening debit as paid', () => {
    const summary = computeStatementSummary(
      [{ total_amount: 1000 }],
      [{ payment_amount: 200 }],
      300
    )

    expect(summary).toEqual({
      total: 1000,
      paid: 200,
      remaining: 1100,
    })
  })
})
