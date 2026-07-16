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
const headers = { apikey: key, Authorization: `Bearer ${key}` };

const r = await fetch(`${url}/rest/v1/clients?client_id=eq.34&select=*`, { headers });
console.log("row34", r.status, await r.text());

// Probe user_id column via a filtered select
const r2 = await fetch(`${url}/rest/v1/clients?select=client_id,user_id&limit=1`, { headers });
console.log("user_id probe", r2.status, await r2.text());

// Cleanup smoke client if present
const del = await fetch(`${url}/rest/v1/clients?client_id=eq.34`, {
  method: "DELETE",
  headers,
});
console.log("cleanup", del.status);
