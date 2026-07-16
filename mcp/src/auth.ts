import type { Request, Response, NextFunction } from 'express';
import { loadConfig } from './config.js';

export interface AuthedUser {
  id: string;
  jwt: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthedUser;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const cfg = loadConfig();

  const secret = req.header('x-mcp-secret');
  if (!secret || secret !== cfg.MCP_SHARED_SECRET) {
    res.status(401).json({ error: 'invalid shared secret' });
    return;
  }

  // Shared secret gates access. The end-user headers are optional and are
  // forwarded for audit/RBAC context only; tool handlers that need Supabase
  // already fall back to the admin (service-role) client internally when
  // these are absent. This lets the bot perform a boot-time liveness probe
  // before a Telegram user has been linked, and lets the agent-monitoring
  // dashboard hit MCP for "whoami"-style reads without an end-user JWT.
  const id = req.header('x-user-id');
  const jwt = req.header('x-user-jwt');
  // Preserve an end-user ID even when no JWT is supplied (the bot forwards
  // the linked-user UUID for audit/RBAC context but never holds the user's
  // actual JWT — only the service-role is held by the bot/MCP). We only
  // synthesise the 'system' identity when the caller sends nothing at all
  // (boot-time liveness probes).
  if (id && jwt) {
    req.user = { id, jwt };
  } else if (id) {
    req.user = { id, jwt: '' };
  } else {
    req.user = { id: 'system', jwt: '' };
  }
  next();
}
