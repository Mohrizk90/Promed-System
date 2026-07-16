import express from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { requireAuth } from './auth.js';
import { tools, type ToolName } from './tools/index.js';
import { writeAudit } from './audit.js';
import { adminClient } from './supabase/userClient.js';
import { currentRequestUser, requestUserStore, type AuthedUser } from './requestContext.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthedUser;
  }
}

const cfg = loadConfig();
const app = express();
app.use(express.json({ limit: '4mb' }));

const server = new McpServer(
  { name: 'promed-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

function registerTools(): void {
  for (const [name, def] of Object.entries(tools) as [ToolName, (typeof tools)[ToolName]][]) {
    // The MCP SDK v1 accepts either a ZodRawShape (object of fields) or a
    // ZodTypeAny (single schema). Our schemas are ZodObjects whose `.shape`
    // is the raw shape. We pass the full Zod schema, which the SDK will
    // introspect via .shape under the hood on supported versions.
    const schemaArg: any = (def.schema as any).shape ?? def.schema;

    server.tool(
      name,
      def.description,
      schemaArg,
      async (args: unknown, extra: any) => {
        const start = Date.now();
        const user: AuthedUser =
          currentRequestUser(
            extra?.authInfo?.user ?? extra?.user ?? extra?.requestContext?.user ?? null,
          );

        try {
          const parsed = (def.schema as any).parse(args ?? {});
          const result = await def.handler(parsed, { user });
          await writeAudit({
            telegramChatId: null,
            userId: user.id,
            toolName: name,
            args: parsed,
            resultStatus: 'ok',
            latencyMs: Date.now() - start,
            source: 'mcp',
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          };
        } catch (err: any) {
          const message = err?.message ?? String(err);
          await writeAudit({
            telegramChatId: null,
            userId: user?.id ?? 'unknown',
            toolName: name,
            args,
            resultStatus: 'error',
            errorText: message,
            latencyMs: Date.now() - start,
            source: 'mcp',
          });
          logger.error({ tool: name, err: message }, 'tool call failed');
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
            isError: true,
          };
        }
      },
    );
  }
}

registerTools();

// Per-session transports. Sharing a single `StreamableHTTPServerTransport`
// across requests fails when the client retries `initialize` — the transport
// has an internal `_initialized` flag that flips to true after the first
// successful init and then refuses all subsequent ones with HTTP 400
// "Server already initialized". The reference Streamable HTTP example in
// the MCP SDK spawns a fresh transport per session and keeps it in a Map
// keyed by the `mcp-session-id` header. We do the same here.
type ServerSession = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};
const sessions = new Map<string, ServerSession>();

function createSession(): ServerSession {
  // Each session gets its own McpServer + transport so its `_initialized`
  // flag is independent. Tool handlers capture shared module state (Supabase
  // admin client, audit writer) by closure, not by `this`, so this is safe.
  const localServer = new McpServer(
    { name: 'promed-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  for (const [name, def] of Object.entries(tools) as [ToolName, (typeof tools)[ToolName]][]) {
    const schemaArg: any = (def.schema as any).shape ?? def.schema;
    localServer.tool(name, def.description, schemaArg, (async (args: unknown, extra: any) => {
      const start = Date.now();
      const user: AuthedUser = currentRequestUser(
        extra?.authInfo?.user ?? extra?.user ?? extra?.requestContext?.user ?? null,
      );
      try {
        const parsed = (def.schema as any).parse(args ?? {});
        const result = await def.handler(parsed, { user });
        await writeAudit({
          telegramChatId: null,
          userId: user.id,
          toolName: name,
          args: parsed,
          resultStatus: 'ok',
          latencyMs: Date.now() - start,
          source: 'mcp',
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err: any) {
        const message = err?.message ?? String(err);
        await writeAudit({
          telegramChatId: null,
          userId: user.id,
          toolName: name,
          args,
          resultStatus: 'error',
          errorText: message,
          latencyMs: Date.now() - start,
          source: 'mcp',
        });
        logger.error({ tool: name, err: message }, 'tool call failed');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
          isError: true,
        };
      }
    }) as any);
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid: string) => {
      sessions.set(sid, { server: localServer, transport });
      logger.info({ session_id: sid }, 'mcp session initialised');
    },
  });
  // Free the slot when the client closes the session.
  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid && sessions.has(sid)) {
      sessions.delete(sid);
      logger.info({ session_id: sid }, 'mcp session closed');
    }
  };

  void localServer.connect(transport).then(() => {
    logger.debug('local mcp server connected to transport');
  });

  return { server: localServer, transport };
}

function getSession(req: Request): ServerSession | undefined {
  const sid = req.headers['mcp-session-id'];
  if (typeof sid === 'string' && sid.length > 0) {
    return sessions.get(sid);
  }
  return undefined;
}

async function handlePost(req: Request, res: Response): Promise<void> {
  const user = req.user ?? { id: 'system', jwt: '' };
  (req as any).auth = { user };
  let session = getSession(req);
  // No session yet, or server was restarted (sessions cleared on boot) —
  // mint a fresh one for this initialize request. The transport will
  // register itself via `onsessioninitialized` once it sees the `initialize`
  // JSON-RPC method.
  if (!session) {
    session = createSession();
  }
  await requestUserStore.run(user, () =>
    session!.transport.handleRequest(req as any, res, req.body),
  );
}

async function handleGet(req: Request, res: Response): Promise<void> {
  const user = req.user ?? { id: 'system', jwt: '' };
  const session = getSession(req);
  if (!session) {
    // Streamable HTTP spec: GET without a valid session ID should 400.
    res.status(400).json({ error: 'missing or unknown mcp-session-id' });
    return;
  }
  await requestUserStore.run(user, () => session.transport.handleRequest(req as any, res));
}

app.post('/mcp', requireAuth, (req: Request, res: Response) => {
  handlePost(req, res).catch((err) => {
    logger.error({ err }, 'mcp POST handler failed');
    if (!res.headersSent) res.status(500).json({ error: (err as Error).message });
  });
});

app.get('/mcp', requireAuth, (req: Request, res: Response) => {
  handleGet(req, res).catch((err) => {
    logger.error({ err }, 'mcp GET handler failed');
    if (!res.headersSent) res.status(500).json({ error: (err as Error).message });
  });
});

// DELETE /mcp closes a session per the Streamable HTTP spec.
app.delete('/mcp', requireAuth, (req: Request, res: Response) => {
  const session = getSession(req);
  if (!session) {
    res.status(400).json({ error: 'missing or unknown mcp-session-id' });
    return;
  }
  session.transport
    .close()
    .then(() => res.status(200).json({ ok: true }))
    .catch((err) => res.status(500).json({ error: (err as Error).message }));
});

app.get('/healthz', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime_s: Math.floor(process.uptime()),
    tools: Object.keys(tools),
  });
});

app.listen(cfg.MCP_PORT, () => {
  logger.info({ port: cfg.MCP_PORT }, 'mcp listening');
});

// Periodic health snapshot to Supabase so the AgentMonitoring dashboard can
// render the MCP service even when no tool calls are firing. Truncated to
// the minute so multiple snapshots in the same minute upsert into one row.
function minuteBucket(d: Date = new Date()): string {
  const t = Math.floor(d.getTime() / 60_000) * 60_000;
  return new Date(t).toISOString();
}
async function emitHealthSnapshot(): Promise<void> {
  const snap = {
    source: 'mcp' as const,
    ts: minuteBucket(),
    status: 'ok' as const,
    uptime_s: Math.floor(process.uptime()),
    gemini_ok: null,
    mcp_ok: true,
    telegram_ok: null,
  };
  const { error } = await adminClient()
    .from('bot_health_snapshots')
    .upsert(snap, { onConflict: 'source,ts' });
  if (error) logger.warn({ err: error.message }, 'mcp health snapshot upsert failed');
}
void emitHealthSnapshot();
setInterval(() => void emitHealthSnapshot(), 60_000).unref();
