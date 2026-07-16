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

  const id = req.header('x-user-id');
  const jwt = req.header('x-user-jwt');
  if (!id || !jwt) {
    res.status(401).json({ error: 'missing x-user-id or x-user-jwt header' });
    return;
  }

  req.user = { id, jwt };
  next();
}
