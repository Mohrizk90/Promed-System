import { AsyncLocalStorage } from 'node:async_hooks';

export type AuthedUser = { id: string; jwt: string };

/** Per-request linked user for MCP tool handlers (Streamable HTTP). */
export const requestUserStore = new AsyncLocalStorage<AuthedUser>();

export function currentRequestUser(
  fallback?: AuthedUser | null,
): AuthedUser {
  return requestUserStore.getStore() ?? fallback ?? { id: 'unknown', jwt: '' };
}
