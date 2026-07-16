import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, userClient } from './userClient.js';

/**
 * Resolve a Supabase client for MCP tool handlers.
 *
 * The Telegram bot forwards a linked `user_id` but never an end-user JWT
 * (it only holds the service role). Calling `userClient(id, '')` puts
 * `Authorization: Bearer ` on every request and Supabase rejects it with
 * "Empty JWT is sent in Authorization header".
 *
 * When a JWT is present (future interactive clients), use the anon + JWT
 * path so RLS applies. Otherwise use the service-role admin client; tools
 * MUST still scope by owner via `scopeByOwner`.
 */
export function dataClient(user: { id: string; jwt: string }): SupabaseClient {
  if (user.jwt && user.jwt.trim().length > 0) {
    return userClient(user.id, user.jwt);
  }
  return adminClient();
}

/** Reject boot/system probes from calling user-scoped data tools. */
export function requireLinkedUser(user: { id: string; jwt: string }): void {
  if (!user?.id || user.id === 'system' || user.id === 'unknown') {
    throw new Error('account not linked — send /link in Telegram first');
  }
}

/**
 * Scope a query to the linked user.
 *
 * Live Promed data often has `user_id IS NULL` (legacy single-tenant rows).
 * The web app's RLS already allows authenticated users to see those rows
 * (`auth.uid() = user_id OR user_id IS NULL`). Mirror that here so the bot
 * sees the same data as the ERP UI.
 */
export function scopeByOwner<T extends { or: (filter: string) => T }>(
  query: T,
  userId: string,
): T {
  return query.or(`user_id.eq.${userId},user_id.is.null`);
}
