/**
 * Live smoke: MCP write tools (create → update → delete a temp client).
 * Run on VPS: node scripts/smoke-mcp-writes.mjs
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

function textOf(result) {
  const parts = result?.content;
  if (!Array.isArray(parts)) return JSON.stringify(result);
  return parts
    .map((p) => (p?.type === "text" ? p.text : JSON.stringify(p)))
    .join("\n");
}

async function main() {
  if (!secret) throw new Error("missing MCP_SHARED_SECRET");
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: { "x-mcp-secret": secret, "x-user-id": userId },
    },
  });
  const client = new Client(
    { name: "promed-smoke-writes", version: "0.1.0" },
    { capabilities: {} },
  );
  await client.connect(transport);

  const tools = await client.listTools();
  const names = (tools.tools ?? []).map((t) => t.name);
  console.log("tools", names.length, names.includes("create_client") ? "has writes" : "MISSING writes");

  const stamp = Date.now();
  const create = await client.callTool({
    name: "create_client",
    arguments: {
      name: `SMOKE-${stamp}`,
      phone: "01000000000",
      opening_balance: 0,
    },
  });
  if (create.isError) throw new Error(textOf(create));
  const created = JSON.parse(textOf(create));
  const id = created.client.id;
  console.log("OK create_client", id, created.client.name);

  const upd = await client.callTool({
    name: "update_client",
    arguments: { id, phone: "01111111111" },
  });
  if (upd.isError) throw new Error(textOf(upd));
  console.log("OK update_client", JSON.parse(textOf(upd)).client.phone);

  const tx = await client.callTool({
    name: "create_client_transaction",
    arguments: {
      client_id: id,
      total_amount: 100,
      issue: true,
    },
  });
  if (tx.isError) throw new Error(textOf(tx));
  const txObj = JSON.parse(textOf(tx));
  const txId = txObj.transaction.id;
  console.log(
    "OK create_client_transaction+issue",
    txId,
    txObj.transaction.invoice_number,
    txObj.transaction.status,
  );

  const pay = await client.callTool({
    name: "add_payment",
    arguments: { transaction_id: txId, amount: 40 },
  });
  if (pay.isError) throw new Error(textOf(pay));
  console.log("OK add_payment", textOf(pay).slice(0, 200));

  const delTx = await client.callTool({
    name: "delete_client_transaction",
    arguments: { id: txId },
  });
  if (delTx.isError) throw new Error(textOf(delTx));
  console.log("OK delete_client_transaction");

  const del = await client.callTool({
    name: "delete_client",
    arguments: { id },
  });
  if (del.isError) throw new Error(textOf(del));
  console.log("OK delete_client");
  console.log("PASS write tool chain");
  await client.close().catch(() => undefined);
}

main().catch((err) => {
  console.error("FAIL", err?.message || err);
  process.exit(1);
});
