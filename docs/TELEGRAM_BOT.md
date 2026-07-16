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

## Manual steps checklist

After cloning and before first run:

1. Apply the SQL migrations in `Supabase/` in order: `supabase_telegram_links.sql`, `supabase_telegram_link_codes.sql`, `supabase_bot_audit.sql`, `supabase_vps_metrics.sql`, `supabase_generated_files_bucket.sql`.
2. Create a Telegram bot via @BotFather, copy the token into `bot/.env` as `TELEGRAM_BOT_TOKEN`.
3. Create a Gemini API key at https://aistudio.google.com/apikey, copy into `bot/.env`.
4. From Supabase dashboard → Settings → API, copy `URL` and `service_role` key into each service's `.env`.
5. Generate a random 32-byte hex string for `MCP_SHARED_SECRET`, copy into both `bot/.env` and `mcp/.env`.
6. Verify the VPS `smops` SSH alias exists in `~/.ssh/config` and `ssh smops 'echo ok'` works.
7. (Optional) Install `snmpd` on the VPS for richer metrics — see `docs/SMOPS_COLLECTOR.md`.
