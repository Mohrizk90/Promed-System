# VPS Collector (`vps-collector/`)

Polls the VPS (alias `smops` in `~/.ssh/config`) over SSH, collects host and process metrics, and writes them to Supabase so the ERP's Agent Monitoring page can render them.

## SSH config

The collector expects an SSH alias named `smops` in your local `~/.ssh/config`:

```
Host smops
  HostName <vps-ip-or-dns>
  User <login-user>
  IdentityFile ~/.ssh/<key>
  ServerAliveInterval 30
  ServerAliveCountMax 3
```

Verify it works before starting the collector:

```bash
ssh smops 'echo SMOPS_OK; uname -a'
```

You can override the alias via `SMOPS_SSH_HOST` in `.env`. If unset, the collector runs in **local fallback** mode and emits synthetic metrics so the dashboard renders during development.

## SNMP install (optional but recommended)

The collector works without SNMP using `/proc` + `df` + `systemctl`. For richer metrics (and a forward path to Grafana/Prometheus), install `snmpd` on the VPS:

```bash
ssh smops 'sudo apt update && sudo apt install -y snmpd'
ssh smops 'sudo systemctl enable --now snmpd'
```

Minimal `/etc/snmp/snmpd.conf` (replace `public` and the network):

```
agentaddress udp:161
rocommunity public 127.0.0.1
```

Reload and test from the VPS:

```bash
ssh smops 'sudo systemctl restart snmpd'
ssh smops 'snmpget -v2c -c public localhost .1.3.6.1.2.1.1.1.0'
```

Set `SMOPS_SNMP_COMMUNITY=public` in `vps-collector/.env` (default already `public`).

## Metrics collected

Without SNMP (always available):

- `cpu_pct` — `/proc/stat` delta.
- `mem_pct` — `/proc/meminfo` (MemTotal vs MemAvailable).
- `disk_pct` — `df -P /`.
- `net_in_bps`, `net_out_bps` — `/proc/net/dev` delta on non-loopback interfaces.
- `bot_up`, `mcp_up` — `systemctl is-active promed-bot`, `promed-mcp`.
- `telegram_queue_lag` — recent log lines in the last minute.

With SNMP:

- `snmpget` of standard `ucdavis` MIBs (ssCpuRawSystem, etc.) when the binary is present.

## Healthz

The collector exposes `GET /healthz` on `COLLECTOR_HEALTH_PORT` (default 8083):

```bash
curl http://127.0.0.1:8083/healthz
# → { status: "ok", uptime_s: 42, last_tick_at: "2026-07-16T...", ssh_connected: true, smops_reachable: true }
```

## Local fallback

When `SMOPS_SSH_HOST` is unset (default in dev), the collector writes synthetic metrics to Supabase tagged with `host = 'smops-local'`. This lets the dashboard render before the VPS is wired up. The dashboard reads from `vps_metrics` regardless of host, so synthetic rows show up alongside real ones.

## Deploy to VPS

Three systemd units (one per service). Drop them into `/etc/systemd/system/`:

### `promed-bot.service`

```ini
[Unit]
Description=Promed Telegram Bot
After=network-online.target

[Service]
Type=simple
User=promed
WorkingDirectory=/opt/promed/bot
EnvironmentFile=/opt/promed/bot/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### `promed-mcp.service`

```ini
[Unit]
Description=Promed MCP Server
After=network-online.target

[Service]
Type=simple
User=promed
WorkingDirectory=/opt/promed/mcp
EnvironmentFile=/opt/promed/mcp/.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### `promed-collector.service`

```ini
[Unit]
Description=Promed VPS Collector
After=network-online.target

[Service]
Type=simple
User=promed
WorkingDirectory=/opt/promed/vps-collector
EnvironmentFile=/opt/promed/vps-collector/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable + start:

```bash
ssh smops 'sudo systemctl daemon-reload && sudo systemctl enable --now promed-bot promed-mcp promed-collector'
ssh smops 'sudo systemctl status promed-bot promed-mcp promed-collector'
```
