import { z } from 'zod';
import { userClient } from '../supabase/userClient.js';

export const listClientsSchema = z.object({
  q: z.string().trim().min(1).optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export const getClientSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
});

type ClientRow = {
  id: string;
  client_name: string | null;
  contact_info: string | null;
  address: string | null;
  opening_balance: number | string | null;
  created_at: string | null;
};

type ClientSummary = {
  id: string;
  name: string | null;
  phone: string | null;
  address: string | null;
  opening_balance: number | null;
  created_at: string | null;
};

function toSummary(row: ClientRow): ClientSummary {
  const ob =
    typeof row.opening_balance === 'string'
      ? Number(row.opening_balance)
      : row.opening_balance;
  return {
    id: row.id,
    name: row.client_name,
    phone: row.contact_info,
    address: row.address,
    opening_balance: ob === null || ob === undefined || Number.isNaN(ob) ? null : ob,
    created_at: row.created_at,
  };
}

export async function listClientsHandler(
  args: z.infer<typeof listClientsSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{ clients: ClientSummary[] }> {
  const supa = userClient(ctx.user.id, ctx.user.jwt);
  const limit = args.limit ?? 50;

  let query = supa
    .from('clients')
    .select('id, client_name, contact_info, address, opening_balance, created_at')
    .eq('user_id', ctx.user.id)
    .order('client_name', { ascending: true })
    .limit(limit);

  if (args.q) {
    const escaped = args.q.replace(/[%_]/g, (m) => `\\${m}`);
    const pattern = `%${escaped}%`;
    query = query.or(`client_name.ilike.${pattern},contact_info.ilike.${pattern}`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`list_clients failed: ${error.message}`);
  const clients = (data ?? []).map((row) => toSummary(row as ClientRow));
  return { clients };
}

type TransactionRow = {
  id: string;
  transaction_date: string | null;
  transaction_type: string | null;
  description: string | null;
  amount: number | string | null;
  status: string | null;
  invoice_number: string | null;
  external_invoice_number?: string | null;
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

export async function getClientHandler(
  args: z.infer<typeof getClientSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{
  client: ClientSummary;
  recent_transactions: Array<{
    id: string;
    transaction_date: string | null;
    transaction_type: string | null;
    description: string | null;
    amount: number | null;
    status: string | null;
    invoice_number: string | null;
    external_invoice_number: string | null;
  }>;
}> {
  const supa = userClient(ctx.user.id, ctx.user.jwt);

  const { data: clientRow, error: clientErr } = await supa
    .from('clients')
    .select('id, client_name, contact_info, address, opening_balance, created_at')
    .eq('id', args.id)
    .eq('user_id', ctx.user.id)
    .single();
  if (clientErr) throw new Error(`get_client failed: ${clientErr.message}`);

  const { data: txRows, error: txErr } = await supa
    .from('client_transactions')
    .select('id, transaction_date, transaction_type, description, amount, status, invoice_number, external_invoice_number, created_at')
    .eq('client_id', args.id)
    .eq('user_id', ctx.user.id)
    .order('transaction_date', { ascending: false })
    .limit(10);
  if (txErr) throw new Error(`get_client transactions failed: ${txErr.message}`);

  return {
    client: toSummary(clientRow as ClientRow),
    recent_transactions: (txRows ?? []).map((row) => {
      const r = row as TransactionRow;
      const amount =
        typeof r.amount === 'string' ? Number(r.amount) : r.amount;
      return {
        id: r.id,
        transaction_date: r.transaction_date,
        transaction_type: r.transaction_type,
        description: r.description,
        amount: amount === null || amount === undefined || Number.isNaN(amount) ? null : amount,
        status: r.status,
        invoice_number: displayInvoiceNumber(r),
        external_invoice_number: r.external_invoice_number?.trim() || null,
      };
    }),
  };
}
