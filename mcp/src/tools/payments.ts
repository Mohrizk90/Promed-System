import { z } from 'zod';
import { dataClient, requireLinkedUser, scopeByOwner } from '../supabase/dataClient.js';
import {
  assertClientAccess,
  assertTransactionAccess,
  nextStatusAfterPayment,
  num,
  todayISO,
} from './access.js';

export const addPaymentSchema = z.object({
  transaction_id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  amount: z.number().positive(),
  payment_date: z.string().trim().optional(),
  payment_method: z.string().trim().optional(),
  reference_number: z.string().trim().optional().nullable(),
});

export const addClientAccountPaymentSchema = z.object({
  client_id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  amount: z.number().positive(),
  payment_date: z.string().trim().optional(),
  payment_method: z.string().trim().optional(),
  reference_number: z.string().trim().optional().nullable(),
});

export const deletePaymentSchema = z.object({
  payment_id: z.union([z.string(), z.number()]).transform((v) => String(v)),
});

function allocateFifo(
  amount: number,
  open: Array<{ transaction_id: string; remaining_amount: number }>,
): Array<{ transaction_id: string; allocated_amount: number }> {
  let left = amount;
  const out: Array<{ transaction_id: string; allocated_amount: number }> = [];
  for (const tx of open) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, tx.remaining_amount));
    if (take <= 0) continue;
    out.push({ transaction_id: tx.transaction_id, allocated_amount: take });
    left = Math.round((left - take) * 100) / 100;
  }
  return out;
}

export async function addPaymentHandler(
  args: z.infer<typeof addPaymentSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{ payment: Record<string, unknown>; transaction: Record<string, unknown> }> {
  const tx = await assertTransactionAccess(ctx.user, args.transaction_id);
  const remaining = num(tx.remaining_amount);
  if (args.amount > remaining + 0.001) {
    throw new Error(
      `payment ${args.amount} exceeds remaining ${remaining} on transaction ${args.transaction_id}`,
    );
  }
  const clientId = tx.client_id == null ? null : String(tx.client_id);
  const supa = dataClient(ctx.user);

  const { data: payment, error: payErr } = await supa
    .from('payments')
    .insert({
      transaction_id: args.transaction_id,
      transaction_type: 'client',
      client_id: clientId,
      payment_amount: args.amount,
      payment_date: args.payment_date || todayISO(),
      payment_method: args.payment_method || 'cash',
      reference_number: args.reference_number ?? null,
      user_id: ctx.user.id,
    })
    .select('payment_id, transaction_id, payment_amount, payment_date, payment_method, reference_number')
    .single();
  if (payErr) throw new Error(`add_payment failed: ${payErr.message}`);

  const newPaid = Math.round((num(tx.paid_amount) + args.amount) * 100) / 100;
  const newRemaining = Math.round((num(tx.total_amount) - newPaid) * 100) / 100;
  const newStatus = nextStatusAfterPayment(String(tx.status ?? ''), newRemaining);

  const { data: updated, error: updErr } = await dataClient(ctx.user)
    .from('client_transactions')
    .update({
      paid_amount: newPaid,
      remaining_amount: newRemaining,
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('transaction_id', args.transaction_id)
    .select(
      'transaction_id, client_id, total_amount, paid_amount, remaining_amount, status, invoice_number',
    )
    .maybeSingle();
  if (updErr) throw new Error(`add_payment update transaction failed: ${updErr.message}`);

  return {
    payment: { id: String(payment.payment_id), ...payment },
    transaction: { id: String(updated?.transaction_id ?? args.transaction_id), ...updated },
  };
}

export async function addClientAccountPaymentHandler(
  args: z.infer<typeof addClientAccountPaymentSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{
  payment: Record<string, unknown>;
  allocations: Array<{ transaction_id: string; allocated_amount: number }>;
  unallocated: number;
}> {
  await assertClientAccess(ctx.user, args.client_id);
  const supa = dataClient(ctx.user);

  const { data: openTx, error: openErr } = await scopeByOwner(
    supa
      .from('client_transactions')
      .select('transaction_id, remaining_amount, transaction_date')
      .eq('client_id', args.client_id)
      .gt('remaining_amount', 0)
      .order('transaction_date', { ascending: true }),
    ctx.user.id,
  );
  if (openErr) throw new Error(`add_client_account_payment open txs failed: ${openErr.message}`);

  const open = (openTx ?? []).map((r) => ({
    transaction_id: String((r as { transaction_id: unknown }).transaction_id),
    remaining_amount: num((r as { remaining_amount: unknown }).remaining_amount),
  }));
  const allocations = allocateFifo(args.amount, open);

  const { data: payment, error: payErr } = await supa
    .from('payments')
    .insert({
      client_id: args.client_id,
      transaction_id: null,
      transaction_type: 'client',
      payment_amount: args.amount,
      payment_date: args.payment_date || todayISO(),
      payment_method: args.payment_method || 'cash',
      reference_number: args.reference_number ?? null,
      user_id: ctx.user.id,
    })
    .select('payment_id, client_id, payment_amount, payment_date, payment_method, reference_number')
    .single();
  if (payErr) throw new Error(`add_client_account_payment failed: ${payErr.message}`);

  if (allocations.length > 0) {
    const { error: allocErr } = await supa.from('payment_allocations').insert(
      allocations.map((a) => ({
        payment_id: payment.payment_id,
        transaction_id: a.transaction_id,
        transaction_type: 'client',
        allocated_amount: a.allocated_amount,
      })),
    );
    if (allocErr) {
      // Best-effort like the ERP UI — payment still recorded.
      console.warn('payment_allocations insert failed', allocErr.message);
    }

    // Also update each invoice balance (in case triggers are absent).
    for (const a of allocations) {
      const tx = await assertTransactionAccess(ctx.user, a.transaction_id);
      const newPaid = Math.round((num(tx.paid_amount) + a.allocated_amount) * 100) / 100;
      const newRemaining = Math.round((num(tx.total_amount) - newPaid) * 100) / 100;
      await dataClient(ctx.user)
        .from('client_transactions')
        .update({
          paid_amount: newPaid,
          remaining_amount: newRemaining,
          status: nextStatusAfterPayment(String(tx.status ?? ''), newRemaining),
          updated_at: new Date().toISOString(),
        })
        .eq('transaction_id', a.transaction_id);
    }
  }

  const allocatedSum = allocations.reduce((s, a) => s + a.allocated_amount, 0);
  return {
    payment: { id: String(payment.payment_id), ...payment },
    allocations,
    unallocated: Math.round((args.amount - allocatedSum) * 100) / 100,
  };
}

export async function deletePaymentHandler(
  args: z.infer<typeof deletePaymentSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{ deleted: true; payment_id: string }> {
  requireLinkedUser(ctx.user);
  const supa = dataClient(ctx.user);

  const { data: pay, error: findErr } = await scopeByOwner(
    supa
      .from('payments')
      .select('payment_id, transaction_id, payment_amount, client_id, transaction_type')
      .eq('payment_id', args.payment_id),
    ctx.user.id,
  ).maybeSingle();
  if (findErr) throw new Error(`delete_payment lookup failed: ${findErr.message}`);
  if (!pay) throw new Error(`payment not found: ${args.payment_id}`);

  const txId = pay.transaction_id != null ? String(pay.transaction_id) : null;
  const amount = num(pay.payment_amount);

  const { error: delErr } = await dataClient(ctx.user)
    .from('payments')
    .delete()
    .eq('payment_id', args.payment_id);
  if (delErr) throw new Error(`delete_payment failed: ${delErr.message}`);

  if (txId) {
    const tx = await assertTransactionAccess(ctx.user, txId);
    const newPaid = Math.max(0, Math.round((num(tx.paid_amount) - amount) * 100) / 100);
    const newRemaining = Math.round((num(tx.total_amount) - newPaid) * 100) / 100;
    await dataClient(ctx.user)
      .from('client_transactions')
      .update({
        paid_amount: newPaid,
        remaining_amount: newRemaining,
        status: nextStatusAfterPayment(String(tx.status ?? ''), newRemaining),
        updated_at: new Date().toISOString(),
      })
      .eq('transaction_id', txId);
  }

  return { deleted: true, payment_id: args.payment_id };
}
