# @promed/bot

Telegram orchestrator for the Promed ERP assistant. Bridges Telegram messages
(voice, photo, text) to Google Gemini with tool calling, and dispatches each
function call to the local **MCP server** over Streamable HTTP.

## Responsibilities

- Receive Telegram messages (text, voice notes, photos, PDFs).
- Maintain per-chat conversation sessions (60 min idle TTL).
- Call Gemini with dynamic MCP tool declarations and re-prompt until the model
  produces a final text/voice answer.
- Send confirmation keyboards for any `write`/`update`/`delete` MCP tool before
  invoking it.
- Write audit, error, and rollup rows into Supabase (service role).
- Expose `/healthz` and `/readyz` for ops.

## Quick start

```bash
cp .env.example .env       # fill in TELEGRAM_BOT_TOKEN, GEMINI_API_KEY, Supabase, MCP
npm install
npm run dev                # tsx watch
```

## Commands

| Command   | What it does                                                   |
|-----------|----------------------------------------------------------------|
| `/start`  | Bilingual welcome + bumps `telegram_links.last_seen_at`.       |
| `/link`   | Generates a 6-char claim code, stores it in `telegram_link_codes`. |
| `/whoami` | Shows the linked Supabase user (email + id).                   |
| `/cancel` | Clears a pending confirmation.                                 |
| `/help`   | Lists commands.                                                 |

## Env vars

See `.env.example`. Required: `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MCP_SERVER_URL`,
`MCP_SHARED_SECRET`. If `TELEGRAM_BOT_TOKEN` is empty the bot boots in
**dry-run** mode and only logs the messages it would have sent.

## Layout

```
src/
  index.ts          entrypoint (boot, polling, healthz, shutdown)
  config.ts         zod-validated env loader
  logger.ts         pino
  audit.ts          Supabase service-role writes (audit, errors, rollups, pending)
  ratelimit.ts      per-chat token bucket
  healthz.ts        tiny http /healthz + /readyz server
  session/store.ts  in-memory chat sessions w/ TTL
  telegram/         handlers, keyboards, /link flow, file helpers
  gemini/           Gemini client + prompt builder
  mcp/              MCP Streamable HTTP client wrapper
```
