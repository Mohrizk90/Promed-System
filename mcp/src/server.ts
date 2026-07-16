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

type AuthedUser = { id: string; jwt: string };

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
        const user: AuthedUser | undefined =
          extra?.authInfo?.user ?? extra?.user ?? extra?.requestContext?.user;

        try {
          const parsed = (def.schema as any).parse(args ?? {});
          const result = await def.handler(parsed, { user: user ?? { id: 'unknown', jwt: '' } });
          await writeAudit({
            telegramChatId: null,
            userId: user?.id ?? 'unknown',
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

// Stateful transport (per Streamable HTTP spec). Clients must capture the
// `Mcp-Session-Id` response header from initialize and resend it on every
// subsequent request. The bot's MCP client (`bot/src/mcp/client.ts`) handles
// that, and curl smoke tests are documented in the README.
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});
await server.connect(transport);

app.post('/mcp', requireAuth, async (req: Request, res: Response) => {
  // The StreamableHTTPServerTransport reads `req.auth` to forward an
  // authenticated principal into the tool handler's `extra` context (see
  // sdk/dist/esm/server/streamableHttp.js:131). The earlier code set
  // `req.authInfo` instead, which the SDK ignored — tool handlers then saw
  // `user.id === 'unknown'` and writes were audited as the system user.
  (req as any).auth = { user: req.user };
  await transport.handleRequest(req as any, res, req.body);
});

app.get('/mcp', requireAuth, async (req: Request, res: Response) => {
  await transport.handleRequest(req as any, res);
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
