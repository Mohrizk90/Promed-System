/**
 * FIFO allocation of an account payment across open invoices (oldest first).
 */
export function allocatePaymentFifo(paymentAmount, transactions = []) {
  const amount = Number(paymentAmount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { allocations: [], unallocatedCredit: 0 }
  }

  const open = [...transactions]
    .filter((tx) => Number(tx.remaining_amount || 0) > 0)
    .sort((a, b) => {
      const byDate = String(a.transaction_date || '').localeCompare(String(b.transaction_date || ''))
      if (byDate !== 0) return byDate
      return (a.transaction_id || 0) - (b.transaction_id || 0)
    })

  let remaining = amount
  const allocations = []

  for (const tx of open) {
    if (remaining <= 0) break
    const due = Number(tx.remaining_amount || 0)
    if (due <= 0) continue
    const allocated = Math.min(due, remaining)
    allocations.push({
      transaction_id: tx.transaction_id,
      allocated_amount: allocated,
    })
    remaining -= allocated
  }

  return {
    allocations,
    unallocatedCredit: Math.max(0, remaining),
  }
}

export function sumPaymentAmounts(payments = []) {
  return payments.reduce((sum, p) => sum + Number(p.payment_amount || 0), 0)
}

export function sumInvoiceTotals(transactions = []) {
  return transactions.reduce((sum, tx) => sum + Number(tx.total_amount || 0), 0)
}

/**
 * Account summary for a client.
 * balance = invoiced - paid (positive = customer owes, negative = credit)
 */
export function getClientAccountSummary(transactions = [], payments = []) {
  const totalInvoiced = sumInvoiceTotals(transactions)
  const totalPaid = sumPaymentAmounts(payments)
  const balance = totalInvoiced - totalPaid
  return {
    totalInvoiced,
    totalPaid,
    amountDue: Math.max(0, balance),
    creditBalance: Math.max(0, -balance),
    balance,
  }
}
