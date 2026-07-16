import { z } from 'zod';
import { dataClient, requireLinkedUser, scopeByOwner } from '../supabase/dataClient.js';

export const listProductsSchema = z.object({
  q: z.string().trim().min(1).optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export const createProductSchema = z.object({
  name: z.string().trim().min(1),
  model: z.string().trim().optional().nullable(),
  unit_price: z.number().min(0).optional(),
  unit_cost: z.number().min(0).optional(),
});

export const updateProductSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  name: z.string().trim().min(1).optional(),
  model: z.string().trim().optional().nullable(),
  unit_price: z.number().min(0).optional(),
  unit_cost: z.number().min(0).optional(),
});

type ProductRow = {
  product_id: number | string;
  product_name: string | null;
  model: string | null;
  unit_price: number | string | null;
  unit_cost?: number | string | null;
};

function toProduct(row: ProductRow) {
  return {
    id: String(row.product_id),
    name: row.product_name,
    model: row.model,
    unit_price:
      row.unit_price === null || row.unit_price === undefined
        ? null
        : Number(row.unit_price),
    unit_cost:
      row.unit_cost === null || row.unit_cost === undefined ? null : Number(row.unit_cost),
  };
}

export async function listProductsHandler(
  args: z.infer<typeof listProductsSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{ products: ReturnType<typeof toProduct>[] }> {
  requireLinkedUser(ctx.user);
  const supa = dataClient(ctx.user);
  const limit = args.limit ?? 50;
  let query = scopeByOwner(
    supa
      .from('products')
      .select('product_id, product_name, model, unit_price, unit_cost')
      .order('product_name', { ascending: true })
      .limit(Math.max(limit, 100)),
    ctx.user.id,
  );
  const { data, error } = await query;
  if (error) throw new Error(`list_products failed: ${error.message}`);
  let products = (data ?? []).map((r) => toProduct(r as ProductRow));
  if (args.q) {
    const q = args.q.toLowerCase();
    products = products.filter(
      (p) =>
        (p.name ?? '').toLowerCase().includes(q) ||
        (p.model ?? '').toLowerCase().includes(q),
    );
  }
  return { products: products.slice(0, limit) };
}

export async function createProductHandler(
  args: z.infer<typeof createProductSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{ product: ReturnType<typeof toProduct> }> {
  requireLinkedUser(ctx.user);
  const supa = dataClient(ctx.user);
  const { data, error } = await supa
    .from('products')
    .insert({
      product_name: args.name,
      model: args.model ?? null,
      unit_price: args.unit_price ?? 0,
      unit_cost: args.unit_cost ?? 0,
      user_id: ctx.user.id,
    })
    .select('product_id, product_name, model, unit_price, unit_cost')
    .single();
  if (error) throw new Error(`create_product failed: ${error.message}`);
  return { product: toProduct(data as ProductRow) };
}

export async function updateProductHandler(
  args: z.infer<typeof updateProductSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<{ product: ReturnType<typeof toProduct> }> {
  requireLinkedUser(ctx.user);
  const supa = dataClient(ctx.user);
  const { data: existing, error: findErr } = await scopeByOwner(
    supa.from('products').select('product_id').eq('product_id', args.id),
    ctx.user.id,
  ).maybeSingle();
  if (findErr) throw new Error(`update_product lookup failed: ${findErr.message}`);
  if (!existing) throw new Error(`product not found: ${args.id}`);

  const patch: Record<string, unknown> = {};
  if (args.name !== undefined) patch.product_name = args.name;
  if (args.model !== undefined) patch.model = args.model;
  if (args.unit_price !== undefined) patch.unit_price = args.unit_price;
  if (args.unit_cost !== undefined) patch.unit_cost = args.unit_cost;

  const { data, error } = await dataClient(ctx.user)
    .from('products')
    .update(patch)
    .eq('product_id', args.id)
    .select('product_id, product_name, model, unit_price, unit_cost')
    .maybeSingle();
  if (error) throw new Error(`update_product failed: ${error.message}`);
  if (!data) throw new Error(`update_product failed: no row for ${args.id}`);
  return { product: toProduct(data as ProductRow) };
}
