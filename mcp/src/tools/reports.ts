import { z } from 'zod';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { adminClient } from '../supabase/userClient.js';
import { dataClient, requireLinkedUser } from '../supabase/dataClient.js';
import { logger } from '../logger.js';

/**
 * The PDF builders load the Amiri Arabic font via browser fetch('/fonts/…'),
 * which doesn't exist in Node — without it Arabic text falls back to
 * helvetica and renders as garbage. Read the TTFs from the repo's
 * public/fonts and inject them as base64 (cached for the process).
 */
let _fontCache: { regular: string; bold: string } | null | undefined;
async function loadFontsFromDisk(): Promise<{ regular: string; bold: string } | null> {
  if (_fontCache !== undefined) return _fontCache ?? null;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fontsDir = path.resolve(here, '..', '..', '..', 'public', 'fonts');
    const [regular, bold] = await Promise.all([
      fs.readFile(path.join(fontsDir, 'Amiri-Regular.ttf')),
      fs.readFile(path.join(fontsDir, 'Amiri-Bold.ttf')),
    ]);
    _fontCache = { regular: regular.toString('base64'), bold: bold.toString('base64') };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Amiri fonts not found; Arabic PDFs will fall back to helvetica');
    _fontCache = null;
  }
  return _fontCache ?? null;
}

/**
 * Company letterhead for generated PDFs. The web app stores these in browser
 * localStorage which the server can't read — configure them via env on the
 * MCP service (COMPANY_NAME etc.) to match the system's statements.
 */
function companySettings(): {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  companyTagline: string;
} {
  return {
    companyName: (process.env.COMPANY_NAME || 'Promed').trim(),
    companyAddress: (process.env.COMPANY_ADDRESS || '').trim(),
    companyPhone: (process.env.COMPANY_PHONE || '').trim(),
    companyEmail: (process.env.COMPANY_EMAIL || '').trim(),
    companyTagline: (process.env.COMPANY_TAGLINE || '').trim(),
  };
}

export const generateClientStatementSchema = z.object({
  client_id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  from: z.string().optional(),
  to: z.string().optional(),
  language: z.enum(['en', 'ar']).optional(),
});

export const generateInvoiceSchema = z.object({
  transaction_id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  language: z.enum(['en', 'ar']).optional(),
});

type ClientRow = {
  client_id: number | string;
  client_name: string | null;
  contact_info: string | null;
  address: string | null;
  opening_balance: number | string | null;
  user_id: string | null;
};

type TransactionRow = {
  transaction_id: number | string;
  client_id: number | string | null;
  transaction_date: string | null;
  total_amount: number | string | null;
  paid_amount?: number | string | null;
  remaining_amount?: number | string | null;
  status: string | null;
  invoice_number: string | null;
  external_invoice_number?: string | null;
  due_date?: string | null;
  payment_terms?: string | null;
  quantity?: number | null;
  unit_price?: number | string | null;
  user_id: string | null;
  products?: { product_name?: string | null; model?: string | null } | null;
  clients?: {
    client_name: string | null;
    contact_info: string | null;
    address: string | null;
  } | Array<{
    client_name: string | null;
    contact_info: string | null;
    address: string | null;
  }> | null;
};

type PaymentRow = {
  payment_id: number | string;
  transaction_id: number | string | null;
  client_id: number | string | null;
  payment_date: string | null;
  payment_amount: number | string | null;
  payment_method: string | null;
  reference_number: string | null;
  user_id: string | null;
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

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : 0;
}

function slugify(input: string): string {
  return input.replace(/\W+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'client';
}

function scopeByUser<T extends { or: Function }>(query: T, userId: string): T {
  return query.or(`user_id.eq.${userId},user_id.is.null`) as T;
}

function asClientEmbed(clients: TransactionRow['clients']) {
  if (!clients) return null;
  if (Array.isArray(clients)) return clients[0] ?? null;
  return clients;
}

function pathToFileUrl(p: string): string {
  let normalized = p.replace(/\\/g, '/');
  if (!normalized.startsWith('/')) normalized = '/' + normalized;
  return 'file://' + encodeURI(normalized).replace(/#/g, '%23');
}

function safeImportBuildStatement(): Promise<any> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.resolve(here, '..', '..', '..', 'src', 'utils', 'generateStatement.js');
  return import(pathToFileUrl(candidate));
}

function safeImportBuildInvoice(): Promise<any> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.resolve(here, '..', '..', '..', 'src', 'utils', 'generateInvoice.js');
  return import(pathToFileUrl(candidate));
}

export async function generateClientStatementHandler(
  args: z.infer<typeof generateClientStatementSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{
  path: string;
  signedUrl: string;
  expires_at: string;
  totals: { opening_balance: number; charges: number; payments: number; closing_balance: number };
  client_name: string | null;
}> {
  requireLinkedUser(ctx.user);
  const supa = dataClient(ctx.user);
  const admin = adminClient();

  const { data: clientRow, error: clientErr } = await scopeByUser(
    supa
      .from('clients')
      .select('client_id, client_name, contact_info, address, opening_balance, user_id')
      .eq('client_id', args.client_id),
    ctx.user.id,
  ).maybeSingle();
  if (clientErr || !clientRow) {
    throw new Error(`client not found: ${clientErr?.message ?? args.client_id}`);
  }
  const client = clientRow as ClientRow;

  let txQuery = scopeByUser(
    supa
      .from('client_transactions')
      .select(
        'transaction_id, client_id, transaction_date, total_amount, status, invoice_number, external_invoice_number, user_id',
      )
      .eq('client_id', args.client_id)
      .order('transaction_date', { ascending: true }),
    ctx.user.id,
  );
  if (args.from) txQuery = txQuery.gte('transaction_date', args.from);
  if (args.to) txQuery = txQuery.lte('transaction_date', args.to);
  const { data: txRows, error: txErr } = await txQuery;
  if (txErr) throw new Error(`statement transactions failed: ${txErr.message}`);
  const transactions = (txRows ?? []) as TransactionRow[];

  const txIds = transactions.map((t) => t.transaction_id).filter(Boolean);
  let payments: PaymentRow[] = [];
  if (txIds.length > 0) {
    const { data: pRows, error: pErr } = await scopeByUser(
      supa
        .from('payments')
        .select(
          'payment_id, transaction_id, client_id, payment_date, payment_amount, payment_method, reference_number, user_id',
        )
        .in('transaction_id', txIds),
      ctx.user.id,
    );
    if (pErr) throw new Error(`statement payments failed: ${pErr.message}`);
    payments = (pRows ?? []) as PaymentRow[];
  }

  const { data: apRows, error: apErr } = await scopeByUser(
    supa
      .from('payments')
      .select(
        'payment_id, transaction_id, client_id, payment_date, payment_amount, payment_method, reference_number, user_id',
      )
      .eq('client_id', args.client_id)
      .is('transaction_id', null),
    ctx.user.id,
  );
  if (apErr) throw new Error(`statement account payments failed: ${apErr.message}`);
  const accountPayments = (apRows ?? []) as PaymentRow[];

  const opening = num(client.opening_balance);
  const charges = transactions.reduce((s, t) => s + num(t.total_amount), 0);
  const paymentTotal =
    payments.reduce((s, p) => s + num(p.payment_amount), 0) +
    accountPayments.reduce((s, p) => s + num(p.payment_amount), 0);
  const totals = {
    opening_balance: opening,
    charges,
    payments: paymentTotal,
    closing_balance: opening + charges - paymentTotal,
  };

  const mappedTransactions = transactions.map((t) => ({
    transaction_id: t.transaction_id,
    transaction_date: t.transaction_date,
    total_amount: num(t.total_amount),
    invoice_number: t.invoice_number,
    external_invoice_number: t.external_invoice_number,
    status: t.status,
  }));
  const mappedPayments = [
    ...payments.map((p) => ({
      transaction_id: p.transaction_id,
      payment_date: p.payment_date,
      payment_amount: num(p.payment_amount),
      payment_method: p.payment_method,
      notes: p.reference_number,
    })),
    ...accountPayments.map((p) => ({
      transaction_id: null,
      payment_date: p.payment_date,
      payment_amount: num(p.payment_amount),
      payment_method: p.payment_method,
      notes: p.reference_number,
    })),
  ];

  const clientPayload = {
    client_id: client.client_id,
    client_name: client.client_name,
    contact_info: client.contact_info,
    address: client.address,
    opening_balance: opening,
  };
  const pdfOptions = {
    language: (args.language ?? 'ar') as 'en' | 'ar',
    dateFrom: args.from ?? null,
    dateTo: args.to ?? null,
    openingBalance: opening,
  };

  // Primary path: render the SAME HTML document the web app prints (Ctrl+P)
  // with headless Chrome. Fallback: the legacy jsPDF-drawn template, so a
  // Chrome hiccup degrades the look but never blocks the statement.
  let bytes: Uint8Array;
  try {
    const { buildStatementHtml } = await import('../pdf/statementHtml.js');
    const { htmlToPdf } = await import('../pdf/htmlToPdf.js');
    const html = await buildStatementHtml({
      client: clientPayload,
      transactions: mappedTransactions,
      payments: mappedPayments,
      company: companySettings(),
      options: pdfOptions,
    });
    bytes = await htmlToPdf(html);
    logger.info({ client_id: args.client_id }, 'statement rendered via headless chrome (html)');
  } catch (htmlErr: any) {
    logger.warn(
      { err: htmlErr?.message },
      'html statement rendering failed; falling back to jsPDF template',
    );
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
    try {
      const out = await buildStatementPdf({
        client: clientPayload,
        transactions: mappedTransactions,
        payments: mappedPayments,
        options: {
          ...companySettings(),
          fontData: await loadFontsFromDisk(),
          ...pdfOptions,
          currency: 'EGP',
        },
      });
      bytes = out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
    } catch (err: any) {
      logger.warn({ err: err?.message }, 'statement pdf generation failed');
      throw err;
    }
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

  return {
    path: storagePath,
    signedUrl: signed.signedUrl,
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    totals,
    client_name: client.client_name,
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
  requireLinkedUser(ctx.user);
  const supa = dataClient(ctx.user);
  const admin = adminClient();

  const { data: txRow, error: txErr } = await scopeByUser(
    supa
      .from('client_transactions')
      .select(
        `transaction_id, client_id, transaction_date, total_amount, paid_amount, remaining_amount,
         status, invoice_number, external_invoice_number, due_date, payment_terms,
         quantity, unit_price, user_id,
         clients:client_id ( client_name, contact_info, address ),
         products:product_id ( product_name, model )`,
      )
      .eq('transaction_id', args.transaction_id),
    ctx.user.id,
  ).maybeSingle();
  if (txErr || !txRow) {
    throw new Error(`transaction not found: ${txErr?.message ?? args.transaction_id}`);
  }
  const transaction = txRow as unknown as TransactionRow;
  const embed = asClientEmbed(transaction.clients);

  const { data: paymentRows, error: payErr } = await scopeByUser(
    supa
      .from('payments')
      .select(
        'payment_id, transaction_id, client_id, payment_date, payment_amount, payment_method, reference_number, user_id',
      )
      .eq('transaction_id', args.transaction_id),
    ctx.user.id,
  );
  if (payErr) throw new Error(`invoice payments failed: ${payErr.message}`);
  const payments = (paymentRows ?? []) as PaymentRow[];

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
      payment_amount: num(p.payment_amount),
      payment_method: p.payment_method,
      notes: p.reference_number,
    }));
    const out = await buildInvoicePdf(
      {
        ...transaction,
        clients: embed,
      },
      {
        ...companySettings(),
        fontData: await loadFontsFromDisk(),
        language: args.language ?? 'ar',
        currency: 'EGP',
        payments: mappedPayments,
      },
    );
    bytes = out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'invoice pdf generation failed');
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

  return {
    path: storagePath,
    signedUrl: signed.signedUrl,
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    invoice_number: displayInvoiceNumber(transaction),
  };
}
