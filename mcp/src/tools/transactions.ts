import { z } from 'zod';
import { dataClient, requireLinkedUser } from '../supabase/dataClient.js';
import {
  allocateInvoiceNumber,
  assertClientAccess,
  assertTransactionAccess,
  nextStatusAfterPayment,
  num,
  todayISO,
} from './access.js';

const lineItemSchema = z.object({
  description: z.string().trim().optional().nullable(),
  quantity: z.number().positive().optional(),
  unit_price: z.number().optional(),
  amount: z.number().optional(),
});

export const createClientTransactionSchema = z.object({
  client_id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  transaction_date: z.string().trim().optional(),
  quantity: z.number().positive().optional(),
  unit_price: z.number().optional(),
  total_amount: z.number().positive().optional(),
  paid_amount: z.number().min(0).optional(),
  status: z
    .enum(['not_started', 'in_progress', 'invoice', 'paused', 'paid', 'done'])
    .optional(),
  product_id: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  external_invoice_number: z.string().trim().optional().nullable(),
  payment_terms: z.string().trim().optional().nullable(),
  due_date: z.string().trim().optional().nullable(),
  line_items: z.array(lineItemSchema).optional(),
  vat_rate: z.number().min(0).optional(),
  wht_rate: z.number().min(0).optional(),
  /** If true, also assign invoice_number and set status to invoice/paid. */
  issue: z.boolean().optional(),
  note: z.string().trim().optional().nullable(),
});

export const updateClientTransactionSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  transaction_date: z.string().trim().optional(),
  quantity: z.number().positive().optional(),
  unit_price: z.number().optional(),
  total_amount: z.number().positive().optional(),
  status: z
    .enum(['not_started', 'in_progress', 'invoice', 'paused', 'paid', 'done'])
    .optional(),
  external_invoice_number: z.string().trim().optional().nullable(),
  payment_terms: z.string().trim().optional().nullable(),
  due_date: z.string().trim().optional().nullable(),
  line_items: z.array(lineItemSchema).optional(),
});

export const issueInvoiceSchema = z.object({
  transaction_id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  external_invoice_number: z.string().trim().optional().nullable(),
});

export const deleteClientTransactionSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
});

function buildAmounts(args: {
  quantity?: number;
  unit_price?: number;
  total_amount?: number;
  paid_amount?: number;
  vat_rate?: number;
  wht_rate?: number;
  line_items?: Array<{ quantity?: number; unit_price?: number; amount?: number }>;
}): {
  quantity: number;
  unit_price: number;
  subtotal: number;
  vat_amount: number;
  wht_amount: number;
  total: number;
  paid: number;
  remaining: number;
} {
  let subtotal = 0;
  if (args.line_items && args.line_items.length > 0) {
    for (const li of args.line_items) {
      if (li.amount != null) subtotal += num(li.amount);
      else subtotal += num(li.quantity, 1) * num(li.unit_price);
    }
  } else if (args.total_amount != null) {
    subtotal = num(args.total_amount);
  } else {
    subtotal = num(args.quantity, 1) * num(args.unit_price);
  }
  if (subtotal <= 0) throw new Error('total_amount must be > 0 (set total_amount or quantity*unit_price)');

  const vatRate = num(args.vat_rate);
  const whtRate = num(args.wht_rate);
  const vat_amount = Math.round(subtotal * vatRate * 100) / 100;
  const wht_amount = Math.round(subtotal * whtRate * 100) / 100;
  const total = Math.round((subtotal + vat_amount - wht_amount) * 100) / 100;
  const paid = Math.min(num(args.paid_amount), total);
  const remaining = Math.round((total - paid) * 100) / 100;
  const quantity = Math.max(1, Math.round(args.quantity ?? 1));
  const unit_price = args.unit_price ?? total;
  return { quantity, unit_price, subtotal, vat_amount, wht_amount, total, paid, remaining };
}

export async function createClientTransactionHandler(
  args: z.infer<typeof createClientTransactionSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{ transaction: Record<string, unknown>; payment?: Record<string, unknown> }> {
  requireLinkedUser(ctx.user);
  await assertClientAccess(ctx.user, args.client_id);
  const amounts = buildAmounts(args);
  const issue = Boolean(args.issue);
  let status = args.status ?? (issue ? 'invoice' : 'in_progress');
  let invoice_number: string | null = null;
  if (issue) {
    invoice_number = await allocateInvoiceNumber(ctx.user);
    if (amounts.remaining <= 0) status = 'paid';
    else status = 'invoice';
  }

  const row: Record<string, unknown> = {
    client_id: args.client_id,
    product_id: args.product_id ?? null,
    quantity: amounts.quantity,
    unit_price: amounts.unit_price,
    total_amount: amounts.total,
    paid_amount: amounts.paid,
    remaining_amount: amounts.remaining,
    transaction_date: args.transaction_date || todayISO(),
    status,
    invoice_number,
    external_invoice_number: args.external_invoice_number ?? null,
    payment_terms: args.payment_terms ?? null,
    due_date: args.due_date ?? null,
    line_items: args.line_items ?? [],
    subtotal_amount: amounts.subtotal,
    vat_rate: args.vat_rate ?? 0,
    vat_amount: amounts.vat_amount,
    wht_rate: args.wht_rate ?? 0,
    wht_amount: amounts.wht_amount,
    user_id: ctx.user.id,
  };

  const supa = dataClient(ctx.user);
  const { data, error } = await supa
    .from('client_transactions')
    .insert(row)
    .select(
      'transaction_id, client_id, transaction_date, total_amount, paid_amount, remaining_amount, status, invoice_number, external_invoice_number',
    )
    .single();
  if (error) throw new Error(`create_client_transaction failed: ${error.message}`);

  let payment: Record<string, unknown> | undefined;
  if (amounts.paid > 0) {
    const { data: pay, error: payErr } = await supa
      .from('payments')
      .insert({
        transaction_id: data.transaction_id,
        transaction_type: 'client',
        client_id: args.client_id,
        payment_amount: amounts.paid,
        payment_date: args.transaction_date || todayISO(),
        payment_method: 'cash',
        user_id: ctx.user.id,
      })
      .select('payment_id, payment_amount, payment_date')
      .single();
    if (payErr) throw new Error(`create payment for transaction failed: ${payErr.message}`);
    payment = pay as Record<string, unknown>;
  }

  return {
    transaction: {
      id: String(data.transaction_id),
      ...data,
      note: args.note ?? null,
    },
    payment,
  };
}

export async function updateClientTransactionHandler(
  args: z.infer<typeof updateClientTransactionSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{ transaction: Record<string, unknown> }> {
  const existing = await assertTransactionAccess(ctx.user, args.id);
  const paid = num(existing.paid_amount);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (args.transaction_date !== undefined) patch.transaction_date = args.transaction_date;
  if (args.status !== undefined) patch.status = args.status;
  if (args.external_invoice_number !== undefined) {
    patch.external_invoice_number = args.external_invoice_number;
  }
  if (args.payment_terms !== undefined) patch.payment_terms = args.payment_terms;
  if (args.due_date !== undefined) patch.due_date = args.due_date;
  if (args.line_items !== undefined) patch.line_items = args.line_items;

  if (
    args.total_amount !== undefined ||
    args.quantity !== undefined ||
    args.unit_price !== undefined ||
    args.line_items !== undefined
  ) {
    const amounts = buildAmounts({
      quantity: args.quantity ?? num(existing.quantity, 1),
      unit_price: args.unit_price ?? num(existing.unit_price),
      total_amount: args.total_amount,
      paid_amount: paid,
      line_items: args.line_items,
    });
    patch.quantity = amounts.quantity;
    patch.unit_price = amounts.unit_price;
    patch.total_amount = amounts.total;
    patch.paid_amount = amounts.paid;
    patch.remaining_amount = amounts.remaining;
    patch.subtotal_amount = amounts.subtotal;
    if (args.status === undefined) {
      patch.status = nextStatusAfterPayment(String(existing.status ?? ''), amounts.remaining);
    }
  }

  const supa = dataClient(ctx.user);
  const { data, error } = await supa
    .from('client_transactions')
    .update(patch)
    .eq('transaction_id', args.id)
    .select(
      'transaction_id, client_id, transaction_date, total_amount, paid_amount, remaining_amount, status, invoice_number, external_invoice_number',
    )
    .maybeSingle();
  if (error) throw new Error(`update_client_transaction failed: ${error.message}`);
  if (!data) throw new Error(`update_client_transaction failed: no row for ${args.id}`);
  return { transaction: { id: String(data.transaction_id), ...data } };
}

export async function issueInvoiceHandler(
  args: z.infer<typeof issueInvoiceSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{ transaction: Record<string, unknown> }> {
  const existing = await assertTransactionAccess(ctx.user, args.transaction_id);
  if (existing.invoice_number) {
    return {
      transaction: {
        id: String(existing.transaction_id),
        ...existing,
        already_issued: true,
      },
    };
  }
  const remaining = num(existing.remaining_amount);
  const invoice_number = await allocateInvoiceNumber(ctx.user);
  const status = remaining <= 0 ? 'paid' : 'invoice';
  const patch: Record<string, unknown> = {
    invoice_number,
    status,
    updated_at: new Date().toISOString(),
  };
  if (args.external_invoice_number !== undefined) {
    patch.external_invoice_number = args.external_invoice_number;
  }

  const supa = dataClient(ctx.user);
  const { data, error } = await supa
    .from('client_transactions')
    .update(patch)
    .eq('transaction_id', args.transaction_id)
    .select(
      'transaction_id, client_id, transaction_date, total_amount, paid_amount, remaining_amount, status, invoice_number, external_invoice_number',
    )
    .maybeSingle();
  if (error) throw new Error(`issue_invoice failed: ${error.message}`);
  if (!data) throw new Error(`issue_invoice failed: no row for ${args.transaction_id}`);
  return { transaction: { id: String(data.transaction_id), ...data } };
}

export async function deleteClientTransactionHandler(
  args: z.infer<typeof deleteClientTransactionSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{ deleted: true; id: string }> {
  await assertTransactionAccess(ctx.user, args.id);
  const supa = dataClient(ctx.user);

  // Delete linked payments first (same as ERP UI).
  const { error: payErr } = await supa
    .from('payments')
    .delete()
    .eq('transaction_id', args.id)
    .eq('transaction_type', 'client');
  if (payErr) throw new Error(`delete payments for transaction failed: ${payErr.message}`);

  const { error } = await supa.from('client_transactions').delete().eq('transaction_id', args.id);
  if (error) throw new Error(`delete_client_transaction failed: ${error.message}`);
  return { deleted: true, id: args.id };
}
