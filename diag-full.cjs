require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const WS = require("ws");
const c = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WS },
    global: { WebSocket: WS },
  },
);
(async () => {
  const errors = await c
    .from("bot_error_feed")
    .select("source,severity,message,context_json,created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  console.log("=== ERRORS (20) ===");
  for (const e of errors.data || []) {
    console.log(
      e.created_at,
      e.source,
      e.severity,
      (e.message || "").replace(/\s+/g, " ").slice(0, 220),
    );
  }
  if (errors.error) console.log("errors query err", errors.error);

  const audits = await c
    .from("bot_audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(15);
  console.log("=== AUDITS ===");
  console.log(JSON.stringify(audits.data, null, 2));
  if (audits.error) console.log("audits query err", audits.error);

  const links = await c.from("telegram_links").select("*").limit(5);
  console.log("=== LINKS ===");
  console.log(JSON.stringify(links.data, null, 2));

  const sessions = await c.from("telegram_sessions").select("chat_id,updated_at,last_user_intent,last_tool_summary").limit(5);
  console.log("=== SESSIONS TABLE ===");
  console.log(JSON.stringify({ data: sessions.data, error: sessions.error }, null, 2));
})();
