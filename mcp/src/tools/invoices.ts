import { z } from 'zod';
import { userClient } from '../supabase/userClient.js';

export const listInvoicesSchema = z.object({
  client_id: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export const getClientTransactionSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
});

type InvoiceRow = {
  id: string;
  client_id: string | null;
  client_name: string | null;
  transaction_date: string | null;
  transaction_type: string | null;
  description: string | null;
  amount: number | string | null;
  status: string | null;
  invoice_number: string | null;
  external_invoice_number?: string | null;
  due_date: string | null;
  created_at: string | null;
};

function displayInvoiceNumber(row: {
  external_invoice_number?: string | null;
  invoice_number?: string | null;
}): string | null {
  const external = (row.external_invoice_number || '').trim();
  if (external) return external;
  const internal = (row.invoice_number || '').trim();
  return internal || null;
}

function normalizeAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isNaN(n) ? null : n;
}

export async function listInvoicesHandler(
  args: z.infer<typeof listInvoicesSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{
  invoices: Array<{
    id: string;
    client_id: string | null;
    client_name: string | null;
    transaction_date: string | null;
    transaction_type: string | null;
    description: string | null;
    amount: number | null;
    status: string | null;
    invoice_number: string | null;
    external_invoice_number: string | null;
    due_date: string | null;
  }>;
}> {
  const supa = userClient(ctx.user.id, ctx.user.jwt);
  const limit = args.limit ?? 50;

  let query = supa
    .from('client_transactions')
    .select(
      'id, client_id, transaction_date, transaction_type, description, amount, status, invoice_number, external_invoice_number, due_date, created_at, clients:client_id ( client_name )',
    )
    .eq('user_id', ctx.user.id)
    .or('status.eq.invoiced,invoice_number.not.is.null')
    .order('transaction_date', { ascending: false })
    .limit(limit);

  if (args.client_id) query = query.eq('client_id', args.client_id);
  if (args.from) query = query.gte('transaction_date', args.from);
  if (args.to) query = query.lte('transaction_date', args.to);

  const { data, error } = await query;
  if (error) throw new Error(`list_invoices failed: ${error.message}`);

  const invoices = (data ?? []).map((row) => {
    const r = row as unknown as InvoiceRow & { clients: Array<{ client_name: string | null }> | null };
    return {
      id: r.id,
      client_id: r.client_id,
      client_name: r.clients?.[0]?.client_name ?? null,
      transaction_date: r.transaction_date,
      transaction_type: r.transaction_type,
      description: r.description,
      amount: normalizeAmount(r.amount),
      status: r.status,
      invoice_number: displayInvoiceNumber(r),
      external_invoice_number: r.external_invoice_number?.trim() || null,
      due_date: r.due_date,
    };
  });
  return { invoices };
}

type PaymentRow = {
  id: string;
  transaction_id: string | null;
  client_id: string | null;
  payment_date: string | null;
  amount: number | string | null;
  payment_method: string | null;
  notes: string | null;
  created_at: string | null;
};

export async function getClientTransactionHandler(
  args: z.infer<typeof getClientTransactionSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{
  transaction: InvoiceRow & { client_name: string | null };
  payments: Array<{
    id: string;
    payment_date: string | null;
    amount: number | null;
    payment_method: string | null;
    notes: string | null;
  }>;
}> {
  const supa = userClient(ctx.user.id, ctx.user.jwt);

  const { data: txRow, error: txErr } = await supa
    .from('client_transactions')
    .select(
      'id, client_id, transaction_date, transaction_type, description, amount, status, invoice_number, external_invoice_number, due_date, created_at, clients:client_id ( client_name )',
    )
    .eq('id', args.id)
    .eq('user_id', ctx.user.id)
    .single();
  if (txErr) throw new Error(`get_client_transaction failed: ${txErr.message}`);

  const txR = txRow as unknown as InvoiceRow & { clients: Array<{ client_name: string | null }> | null };

  const { data: paymentRows, error: payErr } = await supa
    .from('payments')
    .select('id, transaction_id, client_id, payment_date, amount, payment_method, notes, created_at')
    .eq('transaction_id', args.id)
    .eq('user_id', ctx.user.id);
  if (payErr) throw new Error(`get_client_transaction payments failed: ${payErr.message}`);

  return {
    transaction: {
      ...txR,
      client_name: txR.clients?.[0]?.client_name ?? null,
      invoice_number: displayInvoiceNumber(txR),
      external_invoice_number: txR.external_invoice_number?.trim() || null,
    },
    payments: (paymentRows ?? []).map((row) => {
      const r = row as PaymentRow;
      return {
        id: r.id,
        payment_date: r.payment_date,
        amount: normalizeAmount(r.amount),
        payment_method: r.payment_method,
        notes: r.notes,
      };
    }),
  };
}
