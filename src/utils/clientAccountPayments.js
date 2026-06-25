import { supabase } from '../lib/supabase'
import { allocatePaymentFifo } from './paymentAllocation'

/**
 * Record a client account payment and allocate FIFO to open invoices.
 * Requires Supabase migration: supabase_account_payments.sql
 */
export async function recordClientAccountPayment({
  clientId,
  amount,
  paymentDate,
  paymentMethod = 'cash',
  referenceNumber = null,
  transactions = [],
}) {
  const paymentAmount = Number(amount)
  if (!clientId || !Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    throw new Error('Invalid client payment')
  }

  const { allocations, unallocatedCredit } = allocatePaymentFifo(paymentAmount, transactions)

  const { data: payment, error: paymentError } = await supabase
    .from('payments')
    .insert([
      {
        client_id: clientId,
        transaction_id: null,
        transaction_type: 'client',
        payment_amount: paymentAmount,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        reference_number: referenceNumber || null,
      },
    ])
    .select()
    .single()

  if (paymentError) throw paymentError

  // The payment row above is the authoritative receipt and is already committed.
  // Allocations are a derived optimization (FIFO -> open invoices) consumed by
  // statements. If writing them fails (e.g. the payment_allocations migration
  // hasn't been applied, or an RLS policy rejects the row), do NOT fail the whole
  // receipt — that would surface an error toast for a payment that actually
  // succeeded and leave it "only visible after refresh". Record it best-effort.
  let allocationError = null
  if (allocations.length > 0) {
    const { error: allocError } = await supabase.from('payment_allocations').insert(
      allocations.map((row) => ({
        payment_id: payment.payment_id,
        transaction_id: row.transaction_id,
        transaction_type: 'client',
        allocated_amount: row.allocated_amount,
      }))
    )
    if (allocError) {
      allocationError = allocError
      console.warn('Account payment recorded but allocation failed:', allocError)
    }
  }

  return { payment, allocations, unallocatedCredit, allocationError }
}

/** Delete an account-level payment; allocations cascade and invoice paid amounts resync via DB triggers. */
export async function deleteClientAccountPayment(paymentId) {
  if (!paymentId) throw new Error('Invalid payment')
  const { error } = await supabase.from('payments').delete().eq('payment_id', paymentId)
  if (error) throw error
}
