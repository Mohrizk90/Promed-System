import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminClient, userClient } from '../supabase/userClient.js';
import { logger } from '../logger.js';

export const generateClientStatementSchema = z.object({
  client_id: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
  language: z.enum(['en', 'ar']).optional(),
});

export const generateInvoiceSchema = z.object({
  transaction_id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  language: z.enum(['en', 'ar']).optional(),
});

type ClientRow = {
  id: string;
  client_name: string | null;
  contact_info: string | null;
  address: string | null;
  opening_balance: number | string | null;
  user_id: string;
};

type TransactionRow = {
  id: string;
  transaction_id?: string;
  client_id: string | null;
  transaction_date: string | null;
  transaction_type: string | null;
  description: string | null;
  amount: number | string | null;
  total_amount?: number | string | null;
  status: string | null;
  invoice_number: string | null;
  user_id: string;
};

type PaymentRow = {
  id: string;
  transaction_id: string | null;
  client_id: string | null;
  payment_date: string | null;
  amount: number | string | null;
  payment_amount?: number | string | null;
  payment_method: string | null;
  notes: string | null;
  user_id: string;
};

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : 0;
}

function slugify(input: string): string {
  return input.replace(/\W+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'client';
}

function safeImportBuildStatement(): Promise<any> {
  // Resolve relative to this file regardless of cwd.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.resolve(
    here,
    '..', '..', '..', '..', 'src', 'utils', 'generateStatement.js',
  );
  const url = pathToFileUrl(candidate);
  return import(url);
}

function safeImportBuildInvoice(): Promise<any> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.resolve(
    here,
    '..', '..', '..', '..', 'src', 'utils', 'generateInvoice.js',
  );
  const url = pathToFileUrl(candidate);
  return import(url);
}

function pathToFileUrl(p: string): string {
  // Cross-platform file URL: encode spaces + drive letters.
  let normalized = p.replace(/\\/g, '/');
  if (!normalized.startsWith('/')) normalized = '/' + normalized;
  return 'file://' + encodeURI(normalized).replace(/#/g, '%23');
}

export async function generateClientStatementHandler(
  args: z.infer<typeof generateClientStatementSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{
  path: string;
  signedUrl: string;
  expires_at: string;
  totals: { opening_balance: number; charges: number; payments: number; closing_balance: number };
}> {
  const supa = userClient(ctx.user.id, ctx.user.jwt);
  const admin = adminClient();

  // 1) Fetch the client (scoped to this user).
  const { data: clientRow, error: clientErr } = await supa
    .from('clients')
    .select('id, client_name, contact_info, address, opening_balance, user_id')
    .eq('id', args.client_id)
    .eq('user_id', ctx.user.id)
    .single();
  if (clientErr || !clientRow) {
    throw new Error(`client not found: ${clientErr?.message ?? args.client_id}`);
  }
  const client = clientRow as ClientRow;

  // 2) Fetch transactions in the date window.
  let txQuery = supa
    .from('client_transactions')
    .select('id, client_id, transaction_date, transaction_type, description, amount, status, invoice_number, user_id')
    .eq('client_id', args.client_id)
    .eq('user_id', ctx.user.id)
    .order('transaction_date', { ascending: true });
  if (args.from) txQuery = txQuery.gte('transaction_date', args.from);
  else txQuery = txQuery.gte('transaction_date', '1900-01-01');
  if (args.to) txQuery = txQuery.lte('transaction_date', args.to);
  else txQuery = txQuery.lte('transaction_date', '2999-12-31');
  const { data: txRows, error: txErr } = await txQuery;
  if (txErr) throw new Error(`statement transactions failed: ${txErr.message}`);
  const transactions = (txRows ?? []) as TransactionRow[];

  // 3) Fetch payments linked to those transactions.
  const txIds = transactions.map((t) => t.id).filter(Boolean);
  let payments: PaymentRow[] = [];
  if (txIds.length > 0) {
    const { data: pRows, error: pErr } = await supa
      .from('payments')
      .select('id, transaction_id, client_id, payment_date, amount, payment_method, notes, user_id')
      .in('transaction_id', txIds)
      .eq('user_id', ctx.user.id);
    if (pErr) throw new Error(`statement payments failed: ${pErr.message}`);
    payments = (pRows ?? []) as PaymentRow[];
  }

  // 4) Fetch account-level payments (no transaction) for this client.
  const { data: apRows, error: apErr } = await supa
    .from('payments')
    .select('id, transaction_id, client_id, payment_date, amount, payment_method, notes, user_id')
    .eq('client_id', args.client_id)
    .is('transaction_id', null)
    .eq('user_id', ctx.user.id);
  if (apErr) throw new Error(`statement account payments failed: ${apErr.message}`);
  const accountPayments = (apRows ?? []) as PaymentRow[];

  // 5) Running balance.
  let balance = num(client.opening_balance);
  const lines = transactions.map((t) => {
    const charge = t.transaction_type === 'payment' ? 0 : num(t.amount);
    const payment = t.transaction_type === 'payment' ? num(t.amount) : 0;
    balance += charge - payment;
    return { ...t, charge, payment, balance };
  });
  const totals = {
    opening_balance: num(client.opening_balance),
    charges: lines.reduce((s, l) => s + l.charge, 0),
    payments: lines.reduce((s, l) => s + l.payment, 0),
    closing_balance: balance,
  };

  // 6) Dynamic import of the shared PDF builder.
  let mod: any;
  try {
    mod = await safeImportBuildStatement();
  } catch (err: any) {
    throw new Error(`failed to load PDF builder: ${err?.message ?? err}`);
  }
  const buildStatementPdf =
    mod?.buildStatementPdf ?? mod?.default?.buildStatementPdf ?? mod?.default;
  if (typeof buildStatementPdf !== 'function') {
    throw new Error('buildStatementPdf export not found in generateStatement.js');
  }

  let bytes: Uint8Array;
  try {
    // Map our rows to the shape generateStatement expects: transaction_id, total_amount, etc.
    const mappedTransactions = transactions.map((t) => ({
      transaction_id: t.id,
      transaction_date: t.transaction_date,
      total_amount: num(t.amount),
      invoice_number: t.invoice_number,
      description: t.description,
      status: t.status,
    }));
    const mappedPayments = [
      ...payments.map((p) => ({
        transaction_id: p.transaction_id,
        payment_date: p.payment_date,
        payment_amount: num(p.amount),
        payment_method: p.payment_method,
        notes: p.notes,
      })),
      ...accountPayments.map((p) => ({
        transaction_id: null,
        payment_date: p.payment_date,
        payment_amount: num(p.amount),
        payment_method: p.payment_method,
        notes: p.notes,
      })),
    ];
    const out = await buildStatementPdf({
      client,
      transactions: mappedTransactions,
      payments: mappedPayments,
      options: {
        language: args.language ?? 'en',
        dateFrom: args.from ?? null,
        dateTo: args.to ?? null,
        openingBalance: num(client.opening_balance),
        currency: 'EGP',
      },
    });
    bytes = out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
  } catch (err: any) {
    // The browser-targeted builder may try to fetch web fonts; we already
    // expected it to fail in Node. If the only failure is font loading,
    // the resulting PDF bytes are still produced and we proceed.
    logger.warn({ err: err?.message }, 'statement pdf generation warning');
    throw err;
  }

  const filename = `statement-${slugify(client.client_name ?? 'client')}-${args.from ?? 'all'}-${args.to ?? 'all'}.pdf`;
  const storagePath = `statements/${ctx.user.id}/${args.client_id}/${filename}`;

  const { error: upErr } = await admin.storage
    .from('generated-files')
    .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: true });
  if (upErr) throw new Error(`statement upload failed: ${upErr.message}`);

  const { data: signed, error: sigErr } = await admin.storage
    .from('generated-files')
    .createSignedUrl(storagePath, 600);
  if (sigErr || !signed?.signedUrl) {
    throw new Error(`statement signed url failed: ${sigErr?.message ?? 'no url'}`);
  }
  const expiresAt = new Date(Date.now() + 600 * 1000).toISOString();

  return {
    path: storagePath,
    signedUrl: signed.signedUrl,
    expires_at: expiresAt,
    totals,
  };
}

export async function generateInvoiceHandler(
  args: z.infer<typeof generateInvoiceSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{
  path: string;
  signedUrl: string;
  expires_at: string;
  invoice_number: string | null;
}> {
  const supa = userClient(ctx.user.id, ctx.user.jwt);
  const admin = adminClient();

  const { data: txRow, error: txErr } = await supa
    .from('client_transactions')
    .select(
      'id, client_id, transaction_date, transaction_type, description, amount, status, invoice_number, user_id, clients:client_id ( client_name, contact_info, address )',
    )
    .eq('id', args.transaction_id)
    .eq('user_id', ctx.user.id)
    .single();
  if (txErr || !txRow) {
    throw new Error(`transaction not found: ${txErr?.message ?? args.transaction_id}`);
  }
  const transaction = txRow as unknown as TransactionRow & {
    clients: Array<{ client_name: string | null; contact_info: string | null; address: string | null }> | null;
  };

  const { data: paymentRows, error: payErr } = await supa
    .from('payments')
    .select('id, transaction_id, client_id, payment_date, amount, payment_method, notes, user_id')
    .eq('transaction_id', args.transaction_id)
    .eq('user_id', ctx.user.id);
  if (payErr) throw new Error(`invoice payments failed: ${payErr.message}`);
  const payments = (paymentRows ?? []) as PaymentRow[];

  const client: ClientRow = {
    id: transaction.clients?.[0]?.client_name ? transaction.client_id ?? '' : '',
    client_name: transaction.clients?.[0]?.client_name ?? null,
    contact_info: transaction.clients?.[0]?.contact_info ?? null,
    address: transaction.clients?.[0]?.address ?? null,
    opening_balance: 0,
    user_id: ctx.user.id,
  };

  let mod: any;
  try {
    mod = await safeImportBuildInvoice();
  } catch (err: any) {
    throw new Error(`failed to load PDF builder: ${err?.message ?? err}`);
  }
  const buildInvoicePdf =
    mod?.buildInvoicePdf ?? mod?.default?.buildInvoicePdf ?? mod?.default;
  if (typeof buildInvoicePdf !== 'function') {
    throw new Error('buildInvoicePdf export not found in generateInvoice.js');
  }

  let bytes: Uint8Array;
  try {
    const mappedPayments = payments.map((p) => ({
      payment_date: p.payment_date,
      payment_amount: num(p.amount),
      payment_method: p.payment_method,
      notes: p.notes,
    }));
    const out = await buildInvoicePdf(transaction, {
      language: args.language ?? 'en',
      currency: 'EGP',
      payments: mappedPayments,
    });
    bytes = out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'invoice pdf generation warning');
    throw err;
  }

  const storagePath = `invoices/${ctx.user.id}/${args.transaction_id}/invoice-${args.transaction_id}.pdf`;
  const { error: upErr } = await admin.storage
    .from('generated-files')
    .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: true });
  if (upErr) throw new Error(`invoice upload failed: ${upErr.message}`);

  const { data: signed, error: sigErr } = await admin.storage
    .from('generated-files')
    .createSignedUrl(storagePath, 600);
  if (sigErr || !signed?.signedUrl) {
    throw new Error(`invoice signed url failed: ${sigErr?.message ?? 'no url'}`);
  }
  const expiresAt = new Date(Date.now() + 600 * 1000).toISOString();

  return {
    path: storagePath,
    signedUrl: signed.signedUrl,
    expires_at: expiresAt,
    invoice_number: transaction.invoice_number ?? null,
  };
}
