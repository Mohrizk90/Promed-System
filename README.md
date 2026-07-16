# Promed - Transaction Management System

A modern frontend application for managing client and supplier transactions, built with React and Supabase.

## Features

- **Client Transactions**: View, add, edit, and delete client sales transactions
- **Supplier Transactions**: Manage supplier purchase transactions
- **Payments Breakdown**: Detailed view of payments for both clients and suppliers
- **Real-time Updates**: Automatic UI updates when data changes in the database
- **CRUD Operations**: Full create, read, update, and delete functionality
- **Responsive Design**: Modern UI built with Tailwind CSS

## Tech Stack

- **React 18** - UI framework
- **Vite** - Build tool and dev server
- **Supabase** - Backend as a service (database, real-time subscriptions)
- **Tailwind CSS** - Styling
- **React Router** - Navigation

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Supabase

1. Get your Supabase anon key from your Supabase project dashboard:
   - Go to Settings → API
   - Copy the "anon public" key

2. Create a `.env` file in the root directory:

```env
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

Alternatively, you can directly edit `src/lib/supabase.js` and replace `YOUR_ANON_KEY_HERE` with your actual anon key.

### 3. Enable Realtime in Supabase

To enable real-time updates, you need to enable Realtime for your tables in Supabase:

1. Go to your Supabase dashboard
2. Navigate to Database → Replication
3. Enable replication for the following tables:
   - `client_transactions`
   - `supplier_transactions`
   - `payments`

### 4. Run the Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:5173`

### 5. Build for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

## Database Schema

The application expects the following tables in your Supabase database:

- `clients` - Client information
- `suppliers` - Supplier information
- `products` - Product catalog
- `client_transactions` - Sales transactions
- `supplier_transactions` - Purchase transactions
- `payments` - Payment records

See the SQL schema provided in the project documentation for table structures.

## Usage

### Client Transactions

- View all client transactions with summary totals
- Add new transactions by clicking "Add Transaction"
- Edit existing transactions
- Delete transactions
- View remaining balances

### Supplier Transactions

- Manage supplier purchase transactions
- Track payments made to suppliers
- View outstanding balances

### Payments Breakdown

- View detailed payment history for clients and suppliers
- Add new payments to transactions
- Delete payment records
- See total amounts, paid amounts, and remaining balances grouped by client/supplier

## Environment Variables

- `VITE_SUPABASE_URL` - Your Supabase project URL (e.g. `https://xxxx.supabase.co`)
- `VITE_SUPABASE_ANON_KEY` - Your Supabase anonymous/public key (required)

Copy `.env.example` to `.env` and fill in your values for local development.

## Deploy on Vercel

1. **Push your code** to GitHub, GitLab, or Bitbucket.

2. **Import the project** on [Vercel](https://vercel.com):
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import your repository
   - Vercel will detect the Vite app (build: `npm run build`, output: `dist`)

3. **Set environment variables** in the Vercel project:
   - Project → **Settings** → **Environment Variables**
   - Add:
     - `VITE_SUPABASE_URL` = your Supabase project URL (e.g. `https://xxxx.supabase.co`)
     - `VITE_SUPABASE_ANON_KEY` = your Supabase anon/public key

4. **Redeploy** after saving the env vars so the build picks them up.

5. **Supabase Auth (optional):** If using Supabase Auth, add your Vercel site URL in Supabase:
   - **Authentication** → **URL Configuration** → add `https://your-app.vercel.app` to Site URL and Redirect URLs.

The `vercel.json` in the repo configures:
- SPA routing (all routes → `index.html` for React Router)
- Security headers
- Long-lived cache for `/assets/*`

## Notes

- The application connects directly to Supabase without a backend server
- All database operations are handled through Supabase's REST API
- Real-time updates are enabled via Supabase Realtime subscriptions
- Make sure Row Level Security (RLS) policies are configured appropriately in Supabase if you need authentication

## Telegram AI Agent (Phase 1)

Three new services live alongside the React frontend:

| Path | What it does | Docs |
|---|---|---|
| `mcp/` | Node MCP server exposing typed ERP verbs (read tools + PDF generation). | [docs/TELEGRAM_BOT.md](docs/TELEGRAM_BOT.md) |
| `bot/` | Telegram orchestrator: Gemini multimodal, MCP client, voice replies. | [docs/TELEGRAM_BOT.md](docs/TELEGRAM_BOT.md) |
| `vps-collector/` | SSH-into-`smops` collector for CPU/mem/disk/process metrics. | [docs/SMOPS_COLLECTOR.md](docs/SMOPS_COLLECTOR.md) |
| `src/components/AgentMonitoring.jsx` | In-ERP dashboard at `/monitoring/agent`. | [docs/TELEGRAM_BOT.md](docs/TELEGRAM_BOT.md) |

To get the agent end-to-end you also need to apply 5 SQL migrations in `Supabase/`:

1. `supabase_telegram_links.sql`
2. `supabase_telegram_link_codes.sql`
3. `supabase_bot_audit.sql` (creates five tables: `bot_audit_log`, `bot_tool_stats`, `bot_pending_confirmations`, `bot_error_feed`, `bot_health_snapshots`)
4. `supabase_vps_metrics.sql`
5. `supabase_generated_files_bucket.sql`

Then create a Telegram bot via @BotFather, generate a Gemini API key at https://aistudio.google.com/apikey, and fill the `.env.example` files in `mcp/`, `bot/`, `vps-collector/`.

The bot is **multimodal** (text, voice notes, images via Gemini 2.x), speaks in English or Arabic, requires explicit confirmation for destructive actions, and uploads generated PDFs to the `generated-files` storage bucket before sending them back on Telegram.

### Verified smoke test (2026-07-16)

The three services were booted locally against the live Supabase project `fzbefrisiatshbckxhkq` to confirm end-to-end wiring. The Telegram bot reported `status: ok` on `/healthz` with `gemini_ok`, `mcp_ok`, and `telegram_polling_ok` all `true`. Bugs found and fixed during the smoke test are documented in `docs/TELEGRAM_BOT.md` ("Smoke-test notes" section) — these are now part of the codebase.

### Production deploy on `smops` (Phase 2 — webhook mode)

The Telegram agent runs in **webhook mode** on the VPS for reliable long-term delivery and to keep long polling from chewing CPU. Architecture:

```
   Telegram users  ──HTTPS POST──▶  https://promed-tg.smopsai.com/bot<TOKEN>
                                          │  (Let's Encrypt cert)
                                          ▼
                                    nginx (80/443)
                                          │  proxy_pass
                                          ▼
                                   bot :8443 (loopback)
                                          │  Streamable HTTP / MCP SDK
                                          ▼
                                   mcp :8082 (loopback)
                                          │  service-role key
                                          ▼
                              Supabase (db, storage, RLS)
```

Components wired:

| Layer | What | Where |
|---|---|---|
| DNS | `promed-tg` A record → `187.124.3.141` | Hostinger (added via `hostinger-dns` MCP server) |
| TLS | Let's Encrypt cert issued via `certbot --nginx` | `/etc/letsencrypt/live/promed-tg.smopsai.com/` |
| Edge | nginx vhost that 301s HTTP→HTTPS and proxies `/` to loopback:8443 | `/etc/nginx/sites-enabled/promed-tg.smopsai.com` |
| Bot | `systemd` `promed-bot.service`, listens on `127.0.0.1:8443` and calls `bot.setWebHook()` | `/etc/systemd/system/promed-bot.service` |
| MCP | `systemd` `promed-mcp.service`, listens on `127.0.0.1:8082`, per-session transports | `/etc/systemd/system/promed-mcp.service` |
| Collector | `systemd` `promed-collector.service`, SSH-collects `smops` metrics | `/etc/systemd/system/promed-collector.service` |

#### Operational checklist

```bash
# 1. Health from anywhere on the public internet:
curl -fsS https://promed-tg.smopsai.com/healthz

# 2. Tail bot logs on the VPS:
ssh smops "journalctl -u promed-bot -u promed-mcp -u promed-collector -f"

# 3. Reload after a config change:
ssh smops "cd /opt/promed-telegram/repo && git pull && (cd mcp && npm run build) && (cd bot && npm run build) && systemctl restart promed-mcp.service promed-bot.service"

# 4. Inspect the registered Telegram webhook:
curl -fsS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

#### VPS-side pitfalls encountered (and fixed)

- **`.env` line endings (`\r`):** Windows-authored files leave `\r\n` line endings that `dotenv` parses incorrectly. Strip CR before `systemctl` reads the file:
  `tr -d '\r' < .env > .env.lf && mv .env.lf .env`. The bot service unit does this transparently when launched from the `restart-all.sh` helper.
- **Node 20 + Supabase 2.110:** newer `@supabase/supabase-js` checks for global `WebSocket` and fails on Node 20. We inject `ws` as the realtime transport and global; this works on Node 20 and is forward-compatible with Node 22 when the VPS upgrades.
- **`.env` corruption** during the original `tr -d '\r'` step silently dropped a substring (`Qr`) from the bot's service-role key, and an `r` from the Supabase project ref in `SUPABASE_URL`, leading to `ENOTFOUND` and `Invalid API key`. Always cross-check the bot `.env` against the MCP `.env` after transferring keys; the canonical Supabase URL is `https://fzbefrisiatshbckxhkq.supabase.co`.
- **Single shared `StreamableHTTPServerTransport`:** the first MCP implementation reused one transport across requests. After the first successful `initialize` the SDK locks it, and any retry returns "Invalid Request: Server already initialized". Fix: per-session transport (see commit `c5f40d3` "fix(mcp): use per-session StreamableHTTPServerTransport so retries pass").
- **`node-telegram-bot-api` v0.66+** exposes `bot.openWebHook()`. Constructing the bot with `{ webHook: { port, host } }` and calling `openWebHook()` *before* `setWebHook()` is required to avoid Telegram's first POST landing on a closed port.

See `docs/TELEGRAM_BOT.md` for the runtime architecture, MCP tool inventory, and access-control rules.

## Troubleshooting

### Real-time updates not working

- Ensure Realtime is enabled for your tables in Supabase dashboard
- Check that your Supabase anon key is correct
- Verify network connectivity

### Database connection errors

- Verify your Supabase URL and anon key are correct
- Check that your Supabase project is active
- Ensure the database tables exist and match the expected schema
