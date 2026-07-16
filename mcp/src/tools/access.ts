import { dataClient, requireLinkedUser, scopeByOwner } from '../supabase/dataClient.js';

/** Ensure a client row is visible to this user (owned or legacy null). */
export async function assertClientAccess(
  user: { id: string; jwt: string },
  clientId: string,
): Promise<{ client_id: string; client_name: string | null }> {
  requireLinkedUser(user);
  const supa = dataClient(user);
  const { data, error } = await scopeByOwner(
    supa
      .from('clients')
      .select('client_id, client_name, user_id')
      .eq('client_id', clientId),
    user.id,
  ).maybeSingle();
  if (error) throw new Error(`client lookup failed: ${error.message}`);
  if (!data) throw new Error(`client not found: ${clientId}`);
  return {
    client_id: String(data.client_id),
    client_name: data.client_name ?? null,
  };
}

/** Ensure a transaction is visible to this user. */
export async function assertTransactionAccess(
  user: { id: string; jwt: string },
  transactionId: string,
): Promise<Record<string, unknown>> {
  requireLinkedUser(user);
  const supa = dataClient(user);
  const { data, error } = await scopeByOwner(
    supa.from('client_transactions').select('*').eq('transaction_id', transactionId),
    user.id,
  ).maybeSingle();
  if (error) throw new Error(`transaction lookup failed: ${error.message}`);
  if (!data) throw new Error(`transaction not found: ${transactionId}`);
  return data as Record<string, unknown>;
}

export function num(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Allocate next INV-YYYY-#### for this tenant (incl. legacy null user_id rows). */
export async function allocateInvoiceNumber(
  user: { id: string; jwt: string },
): Promise<string> {
  const supa = dataClient(user);
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  // Avoid deep generic chaining on PostgREST builders (TS2589).
  let query = supa
    .from('client_transactions')
    .select('invoice_number')
    .not('invoice_number', 'is', null)
    .ilike('invoice_number', `${prefix}%`)
    .limit(200);
  query = scopeByOwner(query as any, user.id) as typeof query;
  const { data, error } = await query;
  if (error) throw new Error(`invoice number allocate failed: ${error.message}`);
  let max = 0;
  for (const row of data ?? []) {
    const m = String((row as { invoice_number?: string }).invoice_number ?? '').match(
      /INV-\d+-(\d+)/i,
    );
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

export function nextStatusAfterPayment(prevStatus: string | null | undefined, remaining: number): string {
  const prev = prevStatus || 'not_started';
  if (remaining <= 0) return prev === 'done' ? 'done' : 'paid';
  if (prev === 'paid' || prev === 'done') return 'in_progress';
  return prev;
}
