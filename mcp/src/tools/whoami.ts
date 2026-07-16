import { z } from 'zod';
import { adminClient } from '../supabase/userClient.js';

export const whoamiSchema = z.object({});

export type WhoamiResult = {
  user_id: string;
  email: string | null | undefined;
};

/**
 * Report the linked Supabase user. The Telegram bot forwards a user id but
 * never an end-user JWT (service-role only), so we resolve via admin.getUserById.
 */
export async function whoamiHandler(
  _args: z.infer<typeof whoamiSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<WhoamiResult> {
  if (!ctx.user.id || ctx.user.id === 'system' || ctx.user.id === 'unknown') {
    return { user_id: ctx.user.id ?? 'system', email: null };
  }

  if (ctx.user.jwt) {
    const { data, error } = await adminClient().auth.getUser(ctx.user.jwt);
    if (!error && data?.user) {
      return { user_id: ctx.user.id, email: data.user.email ?? null };
    }
  }

  const { data: byId, error: byIdErr } = await adminClient().auth.admin.getUserById(ctx.user.id);
  if (byIdErr) {
    return { user_id: ctx.user.id, email: null };
  }
  return {
    user_id: ctx.user.id,
    email: byId?.user?.email ?? null,
  };
}
