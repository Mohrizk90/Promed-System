/**
 * Live smoke: bot → MCP tool calls (same transport/auth as production).
 * Run on VPS: node scripts/smoke-mcp.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

loadEnv("/opt/promed-telegram/repo/bot/.env");
loadEnv(".env");

const url = process.env.MCP_SERVER_URL || "http://127.0.0.1:8082/mcp";
const secret = process.env.MCP_SHARED_SECRET;
const userId =
  process.env.SMOKE_USER_ID || "bb88be0d-6696-4d62-9628-c4e6825f911c";

if (!secret) {
  console.error("FAIL missing MCP_SHARED_SECRET");
  process.exit(1);
}

function textOf(result) {
  const parts = result?.content;
  if (!Array.isArray(parts)) return JSON.stringify(result);
  return parts
    .map((p) => (p?.type === "text" ? p.text : JSON.stringify(p)))
    .join("\n");
}

async function main() {
  const headers = {
    "x-mcp-secret": secret,
    "x-user-id": userId,
  };
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers },
  });
  const client = new Client(
    { name: "promed-smoke", version: "0.1.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  console.log("OK mcp connected");

  const tools = await client.listTools();
  const names = (tools.tools ?? []).map((t) => t.name);
  console.log("OK listTools", names.join(", "));

  const who = await client.callTool({ name: "whoami", arguments: {} });
  console.log("OK whoami", textOf(who).slice(0, 200));

  const listAr = await client.callTool({
    name: "list_clients",
    arguments: { q: "ام بي اس", limit: 10 },
  });
  const listText = textOf(listAr);
  console.log("OK list_clients(ام بي اس)", listText.slice(0, 500));
  if (listAr.isError) {
    console.error("FAIL list_clients error");
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(listText);
  } catch {
    parsed = null;
  }
  const clients = parsed?.clients ?? [];
  const mps = clients.find(
    (c) => /mps/i.test(String(c?.name ?? "")) || String(c?.id) === "13",
  );
  if (!mps) {
    console.error("FAIL Arabic search did not return MPS");
    process.exit(1);
  }
  console.log("OK fuzzy match", mps.id, mps.name);

  const stmt = await client.callTool({
    name: "generate_client_statement",
    arguments: { client_id: String(mps.id) },
  });
  const stmtText = textOf(stmt);
  console.log("OK generate_client_statement", stmtText.slice(0, 400));
  if (stmt.isError) {
    console.error("FAIL statement error");
    process.exit(1);
  }
  const hasUrl = /signedUrl|http/i.test(stmtText);
  if (!hasUrl) {
    console.error("FAIL statement missing signedUrl");
    process.exit(1);
  }
  console.log("PASS mcp tool chain ok");
  await client.close().catch(() => undefined);
}

main().catch((err) => {
  console.error("FAIL", err?.message || err);
  process.exit(1);
});
