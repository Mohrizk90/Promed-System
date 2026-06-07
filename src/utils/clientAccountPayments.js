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

  if (allocations.length > 0) {
    const { error: allocError } = await supabase.from('payment_allocations').insert(
      allocations.map((row) => ({
        payment_id: payment.payment_id,
        transaction_id: row.transaction_id,
        transaction_type: 'client',
        allocated_amount: row.allocated_amount,
      }))
    )
    if (allocError) throw allocError
  }

  return { payment, allocations, unallocatedCredit }
}

/** Delete an account-level payment; allocations cascade and invoice paid amounts resync via DB triggers. */
export async function deleteClientAccountPayment(paymentId) {
  if (!paymentId) throw new Error('Invalid payment')
  const { error } = await supabase.from('payments').delete().eq('payment_id', paymentId)
  if (error) throw error
}
