import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "../config.js";
import { logger } from "../logger.js";
import { setLastError, setMcpOk } from "../healthz.js";

export type McpToolCallResult = {
  content: unknown;
  isError: boolean;
};

export class MCPStreamableHttpClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private connectPromise: Promise<void> | null = null;
  private connected = false;

  constructor(
    private readonly url: string,
    private readonly secret: string,
    private readonly userId: string | null,
    private readonly userJwt: string | null,
  ) {}

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = (async () => {
      const url = new URL(this.url);
      const headers: Record<string, string> = {
        "x-mcp-secret": this.secret,
      };
      if (this.userId) headers["x-user-id"] = this.userId;
      if (this.userJwt) headers["x-user-jwt"] = this.userJwt;

      this.transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers },
      });
      this.client = new Client(
        { name: "promed-bot", version: "0.1.0" },
        { capabilities: {} },
      );

      const backoffs = [250, 500, 1000, 2000, 4000];
      let lastErr: unknown = null;
      for (let i = 0; i < backoffs.length; i++) {
        // Reset the client/transport on each attempt: if a previous connect()
        // threw mid-way the protocol may already be bound, which makes a
        // subsequent Client.connect() throw "Already connected to a transport".
        try {
          await this.client?.close();
        } catch {
          /* ignore */
        }
        this.client = new Client(
          { name: "promed-bot", version: "0.1.0" },
          { capabilities: {} },
        );
        this.transport = new StreamableHTTPClientTransport(url, {
          requestInit: { headers },
        });
        try {
          await this.client.connect(this.transport);
          this.connected = true;
          setMcpOk(true);
          setLastError(null);
          logger.info({ url: this.url }, "mcp connected");
          return;
        } catch (err) {
          lastErr = err;
          // The MCP server uses a stateful StreamableHTTPServerTransport. If
          // our retry races a previously-issued initialize, the server replies
          // "Invalid Request: Server already initialized". That is harmless —
          // a fresh transport handles it on the next attempt. Demote to debug.
          const msg = (err as Error)?.message ?? "";
          if (/Server already initialized/i.test(msg)) {
            logger.debug({ attempt: i + 1 }, "mcp init race; retrying");
          } else {
            logger.warn({ err, attempt: i + 1 }, "mcp connect failed; retrying");
          }
          await new Promise((r) => setTimeout(r, backoffs[i] ?? 4000));
        }
      }
      setMcpOk(false);
      setLastError(`mcp connect: ${(lastErr as Error)?.message ?? "unknown"}`);
      throw lastErr instanceof Error ? lastErr : new Error("mcp connect failed");
    })();

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async listTools(): Promise<McpTool[]> {
    await this.ensureConnected();
    if (!this.client) throw new Error("mcp client not initialised");
    const { tools } = await this.client.listTools();
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    await this.ensureConnected();
    if (!this.client) throw new Error("mcp client not initialised");
    try {
      const res = await this.client.callTool({ name, arguments: args });
      const isError = Boolean((res as { isError?: boolean }).isError);
      return { content: (res as { content: unknown }).content, isError };
    } catch (err) {
      setLastError(`mcp callTool(${name}): ${(err as Error).message}`);
      throw err;
    }
  }

  async close(): Promise<void> {
    try {
      await this.client?.close();
    } catch (err) {
      logger.warn({ err }, "mcp close error");
    }
    this.connected = false;
    this.client = null;
    this.transport = null;
    setMcpOk(false);
  }
}

/** Lazily build one client per (userId,userJwt) pair so calls carry auth context. */
const pool = new Map<string, MCPStreamableHttpClient>();

export function getMcpClient(userId: string | null, userJwt: string | null): MCPStreamableHttpClient {
  const key = `${userId ?? "_"}|${userJwt ?? "_"}`;
  let c = pool.get(key);
  if (!c) {
    const cfg = loadConfig();
    c = new MCPStreamableHttpClient(cfg.MCP_SERVER_URL, cfg.MCP_SHARED_SECRET, userId, userJwt);
    pool.set(key, c);
  }
  return c;
}

export async function closeAllMcpClients(): Promise<void> {
  await Promise.all([...pool.values()].map((c) => c.close()));
  pool.clear();
}
