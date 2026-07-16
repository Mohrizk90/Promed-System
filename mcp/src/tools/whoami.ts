import { z } from 'zod';
import { adminClient } from '../supabase/userClient.js';

export const whoamiSchema = z.object({});

export type WhoamiResult = {
  user_id: string;
  email: string | null | undefined;
};

export async function whoamiHandler(
  _args: z.infer<typeof whoamiSchema>,
  ctx: { user: { id: string; jwt: string } },
): Promise<WhoamiResult> {
  const { data, error } = await adminClient().auth.getUser(ctx.user.jwt);
  if (error) {
    throw new Error(`failed to resolve user: ${error.message}`);
  }
  return {
    user_id: ctx.user.id,
    email: data.user?.email,
  };
}
