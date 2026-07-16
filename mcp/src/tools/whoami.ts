import { z } from 'zod';
import { adminClient } from '../supabase/userClient.js';

export const whoamiSchema = z.object({});

export type WhoamiResult = {
  user_id: string;
  email: string | null | undefined;
};

/**
 * Report the authenticated Supabase user. The bot forwards an end-user ID + JWT
 * for audit/RBAC context, but `auth.getUser(jwt)` only works with the user's
 * own JWT — it fails for the service-role fallback. So when we have a real
 * linking context we resolve via `getUser(jwt)`; otherwise (boot probes /
 * system calls) we fall back to `getUserById`, which is service-role-friendly.
 */
export async function whoamiHandler(
  _args: z.infer<typeof whoamiSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<WhoamiResult> {
  if (!ctx.user.id || ctx.user.id === 'system' || !ctx.user.jwt) {
    // Boot/system probe — there's no real user to look up.
    return { user_id: ctx.user.id ?? 'system', email: null };
  }
  const { data, error } = await adminClient().auth.getUser(ctx.user.jwt);
  if (error || !data?.user) {
    // JWT may be stale; try getUserById as a degradation path (service-role ok).
    const { data: byId } = await adminClient().auth.admin.getUserById(ctx.user.id);
    return {
      user_id: ctx.user.id,
      email: byId?.user?.email ?? null,
    };
  }
  return {
    user_id: ctx.user.id,
    email: data.user?.email,
  };
}
