#!/usr/bin/env node
/**
 * Daily review collector: gathers what happened since the last review and what looks broken.
 * Read-only. Writes the raw report to .daily-review/YYYY-MM-DD.json (git-ignored: it holds
 * business data) and prints a readable summary.
 *
 *   node scripts/daily-review.mjs [--hours 24]
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { connectionConfig, loadEnvFile } from './db-migrate.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
loadEnvFile(path.join(root, '.env.local'))
if (process.env.GEMINI_API_KEY_PROMED) process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY_PROMED
const OWNER = process.env.TEST_OWNER_ID || 'bb88be0d-6696-4d62-9628-c4e6825f911c'
const outDir = path.join(root, '.daily-review')
fs.mkdirSync(outDir, { recursive: true })

const hoursArg = process.argv.indexOf('--hours')
let since
if (hoursArg > 0) since = new Date(Date.now() - Number(process.argv[hoursArg + 1]) * 3600e3)
else {
  const prev = fs.readdirSync(outDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().pop()
  const prevAt = prev ? JSON.parse(fs.readFileSync(path.join(outDir, prev), 'utf8')).generatedAt : null
  since = prevAt ? new Date(prevAt) : new Date(Date.now() - 24 * 3600e3)
  if (Date.now() - since > 7 * 24 * 3600e3) since = new Date(Date.now() - 7 * 24 * 3600e3)
}

const report = { generatedAt: new Date().toISOString(), since: since.toISOString(), problems: [], sections: {} }
const problem = (area, text) => report.problems.push({ area, text })
const clip = (s, n = 400) => (s == null ? s : String(s).length > n ? String(s).slice(0, n) + '…' : String(s))
const safe = async (name, fn) => {
  try { report.sections[name] = await fn() } catch (e) { report.sections[name] = { error: clip(e.message, 300) }; problem(name, `collector failed: ${clip(e.message, 200)}`) }
}

// ---------------------------------------------------------------- database
const client = new pg.Client(connectionConfig())
await client.connect()
const q = async (sql, args = []) => (await client.query(sql, args)).rows
try {
  await safe('database', async () => {
    const [size] = await q(`select pg_database_size(current_database()) as bytes`)
    const big = await q(`select relname as table, pg_total_relation_size(relid) as bytes from pg_catalog.pg_statio_user_tables order by 2 desc limit 6`)
    const mb = Number(size.bytes) / 1048576
    if (mb > 400) problem('database', `database is ${mb.toFixed(0)} MB (free plan limit 500 MB)`)
    return { sizeMb: Number(mb.toFixed(1)), largestTables: big.map((r) => ({ table: r.table, mb: Number((Number(r.bytes) / 1048576).toFixed(1)) })) }
  })

  // Everything below is read as the owner, through the same row-level security the app uses.
  await client.query('begin')
  await client.query('set local role authenticated')
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: OWNER, role: 'authenticated' })])

  await safe('agentActions', async () => {
    const byStatus = await q(`select status, count(*)::int n from agent_actions where created_at >= $1 group by 1 order by 2 desc`, [since])
    const failed = await q(`select id, kind, summary, error, created_at from agent_actions where status = 'failed' and created_at >= $1 order by created_at desc limit 20`, [since])
    const stalePending = await q(`select id, kind, summary, created_at from agent_actions where status = 'pending' and created_at < now() - interval '1 day' order by created_at desc limit 20`)
    const recent = await q(`select kind, status, summary, created_at from agent_actions where created_at >= $1 order by created_at desc limit 60`, [since])
    for (const f of failed) problem('agent', `action failed: ${clip(f.summary, 120)} — ${clip(f.error, 200)}`)
    if (stalePending.length) problem('agent', `${stalePending.length} action(s) waiting for Confirm for more than a day`)
    return { byStatus, failed, stalePending, recent: recent.map((r) => ({ ...r, summary: clip(r.summary, 160) })) }
  })

  await safe('conversations', async () => {
    const convs = await q(`select id, title, updated_at from agent_conversations where updated_at >= $1 order by updated_at desc limit 30`, [since])
    const out = []
    for (const c of convs) {
      const msgs = await q(`select role, parts, created_at from agent_messages where conversation_id = $1 and created_at >= $2 order by created_at`, [c.id, since])
      const turns = []
      for (const m of msgs) {
        const parts = Array.isArray(m.parts) ? m.parts : []
        const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join(' ').trim()
        const tools = parts.filter((p) => typeof p.type === 'string' && p.type.startsWith('tool-')).map((p) => {
          const name = p.type.slice(5)
          const err = p.state === 'output-error' ? p.errorText : (p.output?.error || (p.output?.status === 'error' ? p.output?.message || 'error' : null))
          if (err) problem('agent', `tool ${name} failed in "${clip(c.title, 60)}": ${clip(err, 200)}`)
          return { name, status: p.output?.status || p.state, error: err ? clip(err, 300) : undefined }
        })
        const files = parts.filter((p) => p.type === 'file').map((p) => p.filename || p.mediaType)
        turns.push({ role: m.role, at: m.created_at, text: clip(text, m.role === 'user' ? 600 : 500), tools: tools.length ? tools : undefined, files: files.length ? files : undefined })
      }
      out.push({ id: c.id, title: c.title, turns })
    }
    return out
  })

  await safe('memory', async () => (await q(`select subject, content, created_at from agent_memory order by created_at desc limit 15`)).map((m) => ({ ...m, content: clip(m.content, 200) })))
  await safe('activity', async () => ({
    ledgerEntries: (await q(`select count(*)::int n, coalesce(sum(amount),0)::numeric total from ledger_entries where created_at >= $1 and deleted_at is null`, [since]))[0],
    clientTransactions: (await q(`select count(*)::int n from client_transactions where created_at >= $1`, [since]))[0]?.n,
    supplierTransactions: (await q(`select count(*)::int n from supplier_transactions where created_at >= $1`, [since]))[0]?.n,
    projectsCreated: (await q(`select count(*)::int n from projects where created_at >= $1`, [since]))[0]?.n,
    boms: (await q(`select count(*)::int n from boms where deleted_at is null`))[0]?.n,
  }))
  await client.query('rollback')
} finally {
  await client.end()
}

// ---------------------------------------------------------------- Gemini
await safe('gemini', async () => {
  const { checkGemini } = await import('../api/_lib/agent/health.js')
  const r = await checkGemini()
  if (!r.ok) problem('gemini', `Gemini check failed: ${r.code} (${r.models.filter((m) => !m.ok).map((m) => m.role).join(', ') || 'live call'})`)
  return { ok: r.ok, code: r.code, liveMs: r.live?.ms, models: r.models.map((m) => ({ role: m.role, id: m.id, ok: m.ok, code: m.code })) }
})

// ---------------------------------------------------------------- Vercel deployments
await safe('vercel', async () => {
  const { VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID } = process.env
  if (!VERCEL_TOKEN) return { skipped: 'no VERCEL_TOKEN' }
  const res = await fetch(`https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT_ID}&teamId=${VERCEL_TEAM_ID}&limit=10&since=${since.getTime()}`, { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } })
  if (!res.ok) throw new Error(`Vercel API ${res.status}`)
  const list = ((await res.json()).deployments || []).map((d) => ({ state: d.state || d.readyState, target: d.target || 'preview', branch: d.meta?.githubCommitRef, commit: d.meta?.githubCommitSha?.slice(0, 7), at: new Date(d.created).toISOString() }))
  for (const d of list.filter((x) => x.state === 'ERROR')) problem('deploy', `${d.target} deploy of ${d.commit} (${d.branch}) failed`)
  const site = await fetch('https://promed-system.vercel.app/', { method: 'HEAD' }).then((r) => r.status).catch((e) => e.message)
  if (site !== 200) problem('deploy', `live site answered ${site}`)
  return { siteStatus: site, deployments: list }
})

// ---------------------------------------------------------------- GitHub Actions (CI + nightly backup)
await safe('github', async () => {
  const raw = execFileSync('gh', ['run', 'list', '--limit', '15', '--json', 'workflowName,conclusion,status,headBranch,createdAt,url'], { cwd: root, encoding: 'utf8' })
  const runs = JSON.parse(raw).filter((r) => new Date(r.createdAt) >= since)
  for (const r of runs.filter((x) => x.conclusion === 'failure')) problem('ci', `${r.workflowName} failed on ${r.headBranch}: ${r.url}`)
  const lastBackup = JSON.parse(raw).find((r) => /backup/i.test(r.workflowName))
  if (!lastBackup || Date.now() - new Date(lastBackup.createdAt) > 36 * 3600e3) problem('backup', 'no nightly backup run in the last 36 hours')
  else if (lastBackup.conclusion !== 'success' && lastBackup.status === 'completed') problem('backup', `last nightly backup: ${lastBackup.conclusion}`)
  return { runs, lastBackup }
})

// ---------------------------------------------------------------- local repo
await safe('repo', async () => {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim()
  return { branch: git('rev-parse', '--abbrev-ref', 'HEAD'), head: git('log', '--oneline', '-1'), dirty: git('status', '--short').split('\n').filter(Boolean).filter((l) => !l.includes('racing-game/')) }
})

const file = path.join(outDir, `${report.generatedAt.slice(0, 10)}.json`)
fs.writeFileSync(file, JSON.stringify(report, null, 2))

const s = report.sections
const lines = [
  `Daily review — since ${report.since}`,
  `Report file: ${file}`,
  '',
  `Problems (${report.problems.length}):`,
  ...(report.problems.length ? report.problems.map((p) => `  - [${p.area}] ${p.text}`) : ['  none']),
  '',
  `Agent actions: ${(s.agentActions?.byStatus || []).map((r) => `${r.status} ${r.n}`).join(', ') || 'none'}`,
  `Conversations active: ${Array.isArray(s.conversations) ? s.conversations.length : '?'} (user messages: ${Array.isArray(s.conversations) ? s.conversations.reduce((n, c) => n + c.turns.filter((t) => t.role === 'user').length, 0) : '?'})`,
  `Gemini: ${s.gemini?.ok ? 'ok' : s.gemini?.code || s.gemini?.error}`,
  `Database: ${s.database?.sizeMb} MB`,
  `Deploys: ${(s.vercel?.deployments || []).map((d) => `${d.target}:${d.state}`).join(', ') || 'none'}`,
  `Last backup: ${s.github?.lastBackup ? `${s.github.lastBackup.conclusion || s.github.lastBackup.status} at ${s.github.lastBackup.createdAt}` : 'unknown'}`,
]
console.log(lines.join('\n'))
