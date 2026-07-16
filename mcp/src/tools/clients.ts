import { z } from 'zod';
import { dataClient, requireLinkedUser } from '../supabase/dataClient.js';

export const listClientsSchema = z.object({
  q: z.string().trim().min(1).optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export const getClientSchema = z.object({
  // Live schema PK is SERIAL `client_id` (number). Accept string|number.
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
});

type ClientRow = {
  client_id: number | string;
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
    id: String(row.client_id),
    name: row.client_name,
    phone: row.contact_info,
    address: row.address,
    opening_balance: ob === null || ob === undefined || Number.isNaN(ob) ? null : ob,
    created_at: row.created_at,
  };
}

/** Scope to the linked user OR legacy rows with null user_id (single-tenant installs). */
function scopeByUser<T extends { or: Function }>(query: T, userId: string): T {
  return query.or(`user_id.eq.${userId},user_id.is.null`) as T;
}

/** Normalize for fuzzy compare: lower-case, strip spaces/punctuation. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

/**
 * Expand Arabic letter-spellings / nicknames into Latin DB names.
 * e.g. «ام بي اس» → MPS
 */
function expandSearchTerms(q: string): string[] {
  const terms = new Set<string>([q, q.trim()]);
  const compact = q.replace(/\s+/g, '');

  // MPS spoken/written Arabic variants
  if (/ام\s*بي\s*اس|امبياس|م\s*بي\s*اس|ام\s*بى\s*اس/i.test(q) || /امبياس|امبىاس/i.test(compact)) {
    terms.add('MPS');
    terms.add('mps');
  }
  if (/^mps$/i.test(q.trim())) {
    terms.add('ام بي اس');
  }

  // Common clinic / hospital shorthand (extend as needed)
  if (/الريتاج/i.test(q)) terms.add('الريتاج');
  if (/اكتوبر|أكتوبر/i.test(q)) {
    terms.add('اكتوبر');
    terms.add('أكتوبر');
  }

  return [...terms];
}

function clientMatchesQuery(c: ClientSummary, q: string): boolean {
  const terms = expandSearchTerms(q).map(norm).filter(Boolean);
  const hay = norm(`${c.name ?? ''} ${c.phone ?? ''} ${c.address ?? ''}`);
  if (!hay) return false;
  return terms.some((t) => t.length > 0 && (hay.includes(t) || t.includes(hay)));
}

export async function listClientsHandler(
  args: z.infer<typeof listClientsSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{ clients: ClientSummary[]; matched_via?: string }> {
  requireLinkedUser(ctx.user);
  const supa = dataClient(ctx.user);
  const limit = args.limit ?? 50;

  // Always load a scoped page, then filter in-memory when `q` is set.
  // This avoids PostgREST dual-.or() quirks and lets us fuzzy-match Arabic
  // transliterations (ام بي اس ↔ MPS) against Latin stored names.
  const { data, error } = await scopeByUser(
    supa
      .from('clients')
      .select('client_id, client_name, contact_info, address, opening_balance, created_at')
      .order('client_name', { ascending: true })
      .limit(Math.max(limit, 200)),
    ctx.user.id,
  );
  if (error) throw new Error(`list_clients failed: ${error.message}`);

  let clients = (data ?? []).map((row) => toSummary(row as ClientRow));
  let matchedVia = 'all';

  if (args.q) {
    const filtered = clients.filter((c) => clientMatchesQuery(c, args.q!));
    if (filtered.length > 0) {
      clients = filtered;
      matchedVia = expandSearchTerms(args.q).join(' | ');
    } else {
      // Soft fallback: return full list so the model can still pick visually
      // instead of dead-ending with "not found".
      matchedVia = `no exact match for "${args.q}"; returning full list for disambiguation`;
    }
  }

  return { clients: clients.slice(0, limit), matched_via: matchedVia };
}

type TransactionRow = {
  transaction_id: number | string;
  transaction_date: string | null;
  description: string | null;
  total_amount: number | string | null;
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
    description: string | null;
    amount: number | null;
    status: string | null;
    invoice_number: string | null;
    external_invoice_number: string | null;
  }>;
}> {
  requireLinkedUser(ctx.user);
  const supa = dataClient(ctx.user);

  const { data: clientRow, error: clientErr } = await scopeByUser(
    supa
      .from('clients')
      .select('client_id, client_name, contact_info, address, opening_balance, created_at')
      .eq('client_id', args.id),
    ctx.user.id,
  ).maybeSingle();
  if (clientErr) throw new Error(`get_client failed: ${clientErr.message}`);
  if (!clientRow) throw new Error(`client not found: ${args.id}`);

  const { data: txRows, error: txErr } = await scopeByUser(
    supa
      .from('client_transactions')
      .select(
        'transaction_id, transaction_date, total_amount, status, invoice_number, external_invoice_number, created_at',
      )
      .eq('client_id', args.id)
      .order('transaction_date', { ascending: false })
      .limit(10),
    ctx.user.id,
  );
  if (txErr) throw new Error(`get_client transactions failed: ${txErr.message}`);

  return {
    client: toSummary(clientRow as ClientRow),
    recent_transactions: (txRows ?? []).map((row) => {
      const r = row as TransactionRow;
      const amount =
        typeof r.total_amount === 'string' ? Number(r.total_amount) : r.total_amount;
      return {
        id: String(r.transaction_id),
        transaction_date: r.transaction_date,
        description: r.description ?? null,
        amount: amount === null || amount === undefined || Number.isNaN(amount) ? null : amount,
        status: r.status,
        invoice_number: displayInvoiceNumber(r),
        external_invoice_number: r.external_invoice_number?.trim() || null,
      };
    }),
  };
}

export const createClientSchema = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  opening_balance: z.number().optional(),
});

export const updateClientSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  name: z.string().trim().min(1).optional(),
  phone: z.string().trim().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  opening_balance: z.number().optional(),
});

export const deleteClientSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
});

export async function createClientHandler(
  args: z.infer<typeof createClientSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{ client: ClientSummary }> {
  requireLinkedUser(ctx.user);
  const supa = dataClient(ctx.user);
  const { data, error } = await supa
    .from('clients')
    .insert({
      client_name: args.name,
      contact_info: args.phone ?? null,
      address: args.address ?? null,
      opening_balance: args.opening_balance ?? 0,
      user_id: ctx.user.id,
    })
    .select('client_id, client_name, contact_info, address, opening_balance, created_at')
    .single();
  if (error) throw new Error(`create_client failed: ${error.message}`);
  return { client: toSummary(data as ClientRow) };
}

export async function updateClientHandler(
  args: z.infer<typeof updateClientSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{ client: ClientSummary }> {
  requireLinkedUser(ctx.user);
  const supa = dataClient(ctx.user);

  // Must be visible under owner scope.
  const { data: existing, error: findErr } = await scopeByUser(
    supa.from('clients').select('client_id').eq('client_id', args.id),
    ctx.user.id,
  ).maybeSingle();
  if (findErr) throw new Error(`update_client lookup failed: ${findErr.message}`);
  if (!existing) throw new Error(`client not found: ${args.id}`);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (args.name !== undefined) patch.client_name = args.name;
  if (args.phone !== undefined) patch.contact_info = args.phone;
  if (args.address !== undefined) patch.address = args.address;
  if (args.opening_balance !== undefined) patch.opening_balance = args.opening_balance;

  // Mutate by PK only — do not re-apply user_id.or() on UPDATE (PostgREST breaks).
  const { data, error } = await supa
    .from('clients')
    .update(patch)
    .eq('client_id', args.id)
    .select('client_id, client_name, contact_info, address, opening_balance, created_at')
    .maybeSingle();
  if (error) throw new Error(`update_client failed: ${error.message}`);
  if (!data) throw new Error(`update_client failed: no row returned for ${args.id}`);
  return { client: toSummary(data as ClientRow) };
}

export async function deleteClientHandler(
  args: z.infer<typeof deleteClientSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{ deleted: true; id: string }> {
  requireLinkedUser(ctx.user);
  const supa = dataClient(ctx.user);
  const { data: existing, error: findErr } = await scopeByUser(
    supa.from('clients').select('client_id').eq('client_id', args.id),
    ctx.user.id,
  ).maybeSingle();
  if (findErr) throw new Error(`delete_client lookup failed: ${findErr.message}`);
  if (!existing) throw new Error(`client not found: ${args.id}`);

  const { error } = await supa.from('clients').delete().eq('client_id', args.id);
  if (error) throw new Error(`delete_client failed: ${error.message}`);
  return { deleted: true, id: args.id };
}

