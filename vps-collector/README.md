# @promed/vps-collector

Node 20 + TypeScript SSH/SNMP collector service for the ProMed VPS (`smops`).

Polls the VPS over SSH (using the local `~/.ssh/config` alias `smops`) and writes
host/process metrics to Supabase so the Agent Monitoring dashboard in the ERP can
display them.

## Quick start

```bash
cp .env.example .env       # fill in SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev                # tsx watch src/index.ts
```

If `SMOPS_SSH_HOST` is **unset**, the collector boots into local fallback mode
and emits plausible synthetic metrics tagged `host='smops-local'`. Useful for
dashboard development without a live VPS connection.

## Production

```bash
npm run build              # tsc -> dist/
npm start                  # node dist/index.js
```

## Health endpoints

- `GET http://127.0.0.1:8083/healthz` — collector liveness + last tick info
- `GET http://127.0.0.1:8083/readyz`  — 200 if last tick succeeded within 2× interval

## Collected metrics (Phase 1)

`cpu_pct`, `mem_pct`, `disk_pct`, `net_in_bps`, `net_out_bps`,
`bot_up`, `mcp_up`, `telegram_queue_lag`, plus optional SNMP OIDs if `snmpd`
is installed on the VPS.

See `docs/SMOPS_COLLECTOR.md` (in the repo root) for the full Phase 1 spec
including `snmpd` install steps.
