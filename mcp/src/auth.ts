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
  req.user = id && jwt ? { id, jwt } : { id: 'system', jwt: '' };
  next();
}
