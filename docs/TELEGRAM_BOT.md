# Promed Telegram Bot

A multimodal Telegram agent that talks to the Promed ERP via MCP.

## Architecture

```
Telegram  ──>  bot/  ──>  Gemini 2.x  ──>  mcp/  ──>  Supabase
                │              │              │
                └── audit ──────┴── healthz ──┘
```

Three new services live alongside the existing Vite frontend:

| Service | Path | Port | Purpose |
|---|---|---|---|
| MCP server | `mcp/` | 8082 | Typed catalog of ERP verbs (Streamable HTTP). |
| Telegram bot | `bot/` | 8081 (healthz) | Polls Telegram, calls Gemini, dispatches MCP tools. |
| VPS collector | `vps-collector/` | 8083 (healthz) | SSHes into VPS, collects host/process metrics. |

The web app at `src/components/AgentMonitoring.jsx` reads from Supabase to render a live dashboard.

## Run locally (dev)

In three terminals:

```bash
# Terminal 1
cd mcp
cp .env.example .env  # fill in values
npm install
npm run dev

# Terminal 2
cd bot
cp .env.example .env
npm install
npm run dev

# Terminal 3
cd vps-collector
cp .env.example .env
npm install
npm run dev

# Terminal 4 — the web app
cd ..
npm run dev
```

If a service is missing its real secrets, it boots in a "dry run" or "local fallback" mode and writes synthetic data so the dashboard still renders.

## Environment variables

See each service's `.env.example`. The shared ones across all three:

- `SUPABASE_URL` — your Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY` — only used server-side for audit writes and storage uploads.
- `MCP_SHARED_SECRET` — must match between bot and MCP.

The bot additionally needs:

- `TELEGRAM_BOT_TOKEN` — from @BotFather.
- `GEMINI_API_KEY` — from Google AI Studio.

The collector needs:

- `SMOPS_SSH_USER` (default `root`) — SSH login user for the `smops` host.
- `SMOPS_SNMP_COMMUNITY` (default `public`) — SNMP v2c community.

## Deploy to VPS

See `docs/SMOPS_COLLECTOR.md` for the SSH/SNMP side and the systemd units for each service.

## Phase status

- **Phase 1 (current):** read-only tools, voice replies, monitoring skeleton, local fallback.
- **Phase 2:** write tools with confirmation, real SSH+SNMP, multimodal images.
- **Phase 3:** VPS deployment, webhook transport, IDE MCP clients.

## Smoke-test notes (applied while bringing the stack online)

A few real bugs surfaced when the three services were booted against the live Supabase project. They're fixed in the current code; recording them here so anyone re-running the smoke test doesn't think they're new.

1. **`x-mcp-secret` vs `x-shared-secret`** — the MCP auth middleware reads `x-mcp-secret` (server is the authority). The original bot client sent `x-shared-secret`. Aligned to `x-mcp-secret` in `bot/src/mcp/client.ts`.
2. **`req.auth` vs `req.authInfo`** — `@modelcontextprotocol/sdk` v1.29 reads `req.auth` (line 131 of `dist/esm/server/streamableHttp.js`) to forward the authenticated user into the tool handler's `extra` context. The MCP server was setting `req.authInfo`, which the SDK silently ignored, so every tool call audited as user `unknown`. Fixed to `req.auth` in `mcp/src/server.ts`.
3. **`telegram_polling_ok` never flipped true on happy path** — original code `await bot.once("polling_error", () => resolve())` waits for an error that never fires. Replaced with a long-lived `bot.on("polling_error", ...)` and an immediate `setTelegramPollingOk(true)` after `startPolling()` resolves.
4. **`pino-pretty` missing** — dev logger referenced it but it wasn't installed. Now a soft fallback: uses pretty logs when `pino-pretty` resolves, plain JSON otherwise.
5. **Audit row schema** — original `bot_audit_log` had `telegram_chat_id BIGINT NOT NULL` and `user_id UUID REFERENCES auth.users(id)`. MCP-direct calls have neither, so inserts silently failed (and the catch in `writeAudit` swallowed the error). Migration file now ships with relaxed columns (`telegram_chat_id` nullable, `user_id` free-form TEXT) and includes an `ALTER` block for projects that already applied the stricter schema — re-run `supabase_bot_audit.sql` to upgrade in place.
   - **Heads-up when re-running:** the upgrade path drops and recreates the `bot_audit_log_select` RLS policy because Postgres refuses to alter a column type while a policy depends on it. The replacement policy uses `auth.uid()::text = user_id`, which behaves identically to the original `auth.uid() = user_id` thanks to an implicit `uuid → text` cast.

## Manual steps checklist

After cloning and before first run:

1. Apply the SQL migrations in `Supabase/` in order: `supabase_telegram_links.sql`, `supabase_telegram_link_codes.sql`, `supabase_bot_audit.sql`, `supabase_vps_metrics.sql`, `supabase_generated_files_bucket.sql`. Re-running `supabase_bot_audit.sql` is a no-op for fresh installs and upgrades existing schemas.
2. Create a Telegram bot via @BotFather, copy the token into `bot/.env` as `TELEGRAM_BOT_TOKEN`.
3. Create a Gemini API key at https://aistudio.google.com/apikey, copy into `bot/.env`.
4. From Supabase dashboard → Settings → API, copy `URL` and `service_role` key into each service's `.env`.
5. Generate a random 32-byte hex string for `MCP_SHARED_SECRET`, copy into both `bot/.env` and `mcp/.env`.
6. Verify the VPS `smops` SSH alias exists in `~/.ssh/config` and `ssh smops 'echo ok'` works.
7. (Optional) Install `snmpd` on the VPS for richer metrics — see `docs/SMOPS_COLLECTOR.md`.
