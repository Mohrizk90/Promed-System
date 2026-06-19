/**
 * Decide the next status for a transaction after a payment is added or deleted.
 */
export function nextStatusAfterPaymentChange(prevStatus, newRemainingAmount) {
  const prev = prevStatus || 'not_started'
  if (newRemainingAmount <= 0) {
    return prev === 'done' ? 'done' : 'paid'
  }
  if (prev === 'paid' || prev === 'done') return 'in_progress'
  return prev
}
