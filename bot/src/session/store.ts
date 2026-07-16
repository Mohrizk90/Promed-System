const IDLE_TTL_MS = 60 * 60 * 1000; // 60 minutes
const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes

export type ChatTurn =
  | { role: "user"; parts: Array<{ text: string }> }
  | { role: "model"; parts: Array<{ text: string }> }
  | { role: "function"; name: string; response: unknown };

export type PendingConfirmation = {
  tool: string;
  args: Record<string, unknown>;
  argsHash: string;
  summary: string;
  expiresAt: number;
  nonce: string;
};

export type Session = {
  chatId: number;
  turns: ChatTurn[];
  lastToolSummary?: string;
  pendingConfirmation?: PendingConfirmation;
  lastActivity: number;
};

const store = new Map<number, Session>();

function now(): number {
  return Date.now();
}

function evictExpired(): void {
  const t = now();
  for (const [chatId, s] of store) {
    if (t - s.lastActivity > IDLE_TTL_MS) {
      store.delete(chatId);
    }
  }
}

export function getSession(chatId: number): Session {
  evictExpired();
  let s = store.get(chatId);
  if (!s) {
    s = { chatId, turns: [], lastActivity: now() };
    store.set(chatId, s);
  }
  s.lastActivity = now();
  // Also clean up an expired pending confirmation on touch.
  if (s.pendingConfirmation && s.pendingConfirmation.expiresAt < now()) {
    delete s.pendingConfirmation;
  }
  return s;
}

export function clearPendingFor(chatId: number): void {
  const s = store.get(chatId);
  if (s) delete s.pendingConfirmation;
}

export function forget(chatId: number): void {
  store.delete(chatId);
}

export function activeSessionCount(): number {
  return store.size;
}
