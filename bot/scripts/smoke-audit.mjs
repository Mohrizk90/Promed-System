import { readFileSync, existsSync } from "node:fs";

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

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const res = await fetch(
  `${url}/rest/v1/bot_audit_log?select=created_at,tool_name,result_status,latency_ms,telegram_chat_id&order=created_at.desc&limit=12`,
  {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  },
);
const body = await res.text();
if (!res.ok) {
  console.error("ERR", res.status, body);
  process.exit(1);
}
console.log(body);
