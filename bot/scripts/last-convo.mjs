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
const h = { apikey: key, Authorization: `Bearer ${key}` };

const audit = await fetch(
  `${url}/rest/v1/bot_audit_log?select=created_at,tool_name,result_status,latency_ms,telegram_chat_id,error_text,args_json&order=created_at.desc&limit=25`,
  { headers: h },
);
console.log("=== AUDIT ===");
console.log(await audit.text());

const err = await fetch(
  `${url}/rest/v1/bot_error_feed?select=created_at,source,severity,message,context_json&order=created_at.desc&limit=15`,
  { headers: h },
);
console.log("\n=== ERRORS ===");
console.log(await err.text());

const sess = await fetch(
  `${url}/rest/v1/telegram_sessions?select=chat_id,last_user_intent,last_tool_summary,updated_at,turns&order=updated_at.desc&limit=3`,
  { headers: h },
);
console.log("\n=== SESSIONS ===");
const st = await sess.text();
console.log(st.slice(0, 4000));
