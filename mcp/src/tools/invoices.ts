import { z } from 'zod';
import { dataClient, requireLinkedUser } from '../supabase/dataClient.js';

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
  transaction_id: number | string;
  client_id: number | string | null;
  transaction_date: string | null;
  total_amount: number | string | null;
  status: string | null;
  invoice_number: string | null;
  external_invoice_number?: string | null;
  due_date: string | null;
  created_at: string | null;
  clients?: { client_name: string | null } | Array<{ client_name: string | null }> | null;
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

function clientNameOf(row: InvoiceRow): string | null {
  const c = row.clients;
  if (!c) return null;
  if (Array.isArray(c)) return c[0]?.client_name ?? null;
  return c.client_name ?? null;
}

function scopeByUser<T extends { or: Function }>(query: T, userId: string): T {
  return query.or(`user_id.eq.${userId},user_id.is.null`) as T;
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
    amount: number | null;
    status: string | null;
    invoice_number: string | null;
    external_invoice_number: string | null;
    due_date: string | null;
  }>;
}> {
  requireLinkedUser(ctx.user);
  const supa = dataClient(ctx.user);
  const limit = args.limit ?? 50;

  let query = scopeByUser(
    supa
      .from('client_transactions')
      .select(
        'transaction_id, client_id, transaction_date, total_amount, status, invoice_number, external_invoice_number, due_date, created_at, clients:client_id ( client_name )',
      )
      .or('status.eq.invoice,status.eq.invoiced,invoice_number.not.is.null')
      .order('transaction_date', { ascending: false })
      .limit(limit),
    ctx.user.id,
  );

  if (args.client_id) query = query.eq('client_id', args.client_id);
  if (args.from) query = query.gte('transaction_date', args.from);
  if (args.to) query = query.lte('transaction_date', args.to);

  const { data, error } = await query;
  if (error) throw new Error(`list_invoices failed: ${error.message}`);

  const invoices = (data ?? []).map((row) => {
    const r = row as unknown as InvoiceRow;
    return {
      id: String(r.transaction_id),
      client_id: r.client_id == null ? null : String(r.client_id),
      client_name: clientNameOf(r),
      transaction_date: r.transaction_date,
      amount: normalizeAmount(r.total_amount),
      status: r.status,
      invoice_number: displayInvoiceNumber(r),
      external_invoice_number: r.external_invoice_number?.trim() || null,
      due_date: r.due_date,
    };
  });
  return { invoices };
}

type PaymentRow = {
  payment_id: number | string;
  transaction_id: number | string | null;
  client_id: number | string | null;
  payment_date: string | null;
  payment_amount: number | string | null;
  payment_method: string | null;
  reference_number: string | null;
};

export async function getClientTransactionHandler(
  args: z.infer<typeof getClientTransactionSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{
  transaction: {
    id: string;
    client_id: string | null;
    client_name: string | null;
    transaction_date: string | null;
    amount: number | null;
    status: string | null;
    invoice_number: string | null;
    external_invoice_number: string | null;
    due_date: string | null;
  };
  payments: Array<{
    id: string;
    payment_date: string | null;
    amount: number | null;
    payment_method: string | null;
    notes: string | null;
  }>;
}> {
  requireLinkedUser(ctx.user);
  const supa = dataClient(ctx.user);

  const { data: txRow, error: txErr } = await scopeByUser(
    supa
      .from('client_transactions')
      .select(
        'transaction_id, client_id, transaction_date, total_amount, status, invoice_number, external_invoice_number, due_date, created_at, clients:client_id ( client_name )',
      )
      .eq('transaction_id', args.id),
    ctx.user.id,
  ).maybeSingle();
  if (txErr) throw new Error(`get_client_transaction failed: ${txErr.message}`);
  if (!txRow) throw new Error(`transaction not found: ${args.id}`);

  const txR = txRow as unknown as InvoiceRow;

  const { data: paymentRows, error: payErr } = await scopeByUser(
    supa
      .from('payments')
      .select('payment_id, transaction_id, client_id, payment_date, payment_amount, payment_method, reference_number')
      .eq('transaction_id', args.id),
    ctx.user.id,
  );
  if (payErr) throw new Error(`get_client_transaction payments failed: ${payErr.message}`);

  return {
    transaction: {
      id: String(txR.transaction_id),
      client_id: txR.client_id == null ? null : String(txR.client_id),
      client_name: clientNameOf(txR),
      transaction_date: txR.transaction_date,
      amount: normalizeAmount(txR.total_amount),
      status: txR.status,
      invoice_number: displayInvoiceNumber(txR),
      external_invoice_number: txR.external_invoice_number?.trim() || null,
      due_date: txR.due_date,
    },
    payments: (paymentRows ?? []).map((row) => {
      const r = row as PaymentRow;
      return {
        id: String(r.payment_id),
        payment_date: r.payment_date,
        amount: normalizeAmount(r.payment_amount),
        payment_method: r.payment_method,
        notes: r.reference_number,
      };
    }),
  };
}
