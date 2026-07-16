# Promed MCP Server

A Model Context Protocol (MCP) server that exposes the Promed backend's
Supabase data (clients, invoices, statements, reports) to LLM clients such as
the Telegram bot.

## What it does

- Speaks MCP over HTTP (Streamable HTTP transport) at `POST /mcp`.
- Authenticates each request via `x-mcp-secret`, `x-user-id`, and
  `x-user-jwt` headers. All Supabase queries are scoped to the calling user via
  Row Level Security.
- Exposes tools: `whoami`, `list_clients`, `get_client`, `list_invoices`,
  `get_client_transaction`, `generate_client_statement`, `generate_invoice`.
- Generates PDF statements/invoices via `src/utils/generateStatement.js` and
  `src/utils/generateInvoice.js` (dynamic ESM import), uploads them to the
  `generated-files` Supabase Storage bucket, and returns short-lived signed
  URLs.
- Writes every tool invocation to the `bot_audit_log` table.

## Run in dev

```bash
cp .env.example .env
# fill in real Supabase credentials and a random MCP_SHARED_SECRET
npm install
npm run dev
```

The server listens on `MCP_PORT` (default `8082`). Healthcheck:

```bash
curl http://localhost:8082/healthz
```

## Example: list available tools via MCP initialize + tools/list

```bash
curl -X POST http://localhost:8082/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-mcp-secret: $MCP_SHARED_SECRET" \
  -H "x-user-id: $USER_UUID" \
  -H "x-user-jwt: $USER_JWT" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

## Build for production

```bash
npm run build
npm start
```
