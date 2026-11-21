#!/usr/bin/env node
/**
 * Tiny, portable migration runner for plain Postgres (Supabase today, a VPS later).
 *
 *   npm run db:migrate            apply pending migrations in db/migrations (sorted by name)
 *   npm run db:migrate -- --status  list applied / pending
 *
 * Connection: DATABASE_URL (env or .env.local). Each file runs in its own transaction and
 * is recorded in public.app_migrations with a checksum, so an edited, already-applied file
 * is reported instead of silently re-run.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'db', 'migrations')

export function loadEnvFile(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

export function connectionConfig() {
  loadEnvFile(path.join(root, '.env.local'))
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set (put it in .env.local or the environment)')
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url)
  return { connectionString: url, ssl: local ? false : { rejectUnauthorized: false } }
}

async function main() {
  const statusOnly = process.argv.includes('--status')
  const client = new pg.Client(connectionConfig())
  await client.connect()
  try {
    await client.query(`create table if not exists public.app_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`)
    await client.query('alter table public.app_migrations enable row level security')
    const applied = new Map((await client.query('select name, checksum from public.app_migrations')).rows.map((r) => [r.name, r.checksum]))
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    let ran = 0
    for (const f of files) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8')
      const sum = crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16)
      if (applied.has(f)) {
        if (applied.get(f) !== sum) console.warn(`! ${f} changed after it was applied (not re-run)`)
        else if (statusOnly) console.log(`  applied  ${f}`)
        continue
      }
      if (statusOnly) { console.log(`  pending  ${f}`); continue }
      process.stdout.write(`→ ${f} … `)
      try {
        await client.query('begin')
        await client.query(sql)
        await client.query('insert into public.app_migrations(name, checksum) values ($1, $2)', [f, sum])
        await client.query('commit')
        console.log('ok')
        ran++
      } catch (e) {
        await client.query('rollback')
        console.log('FAILED')
        throw new Error(`${f}: ${e.message}`)
      }
    }
    if (!statusOnly) console.log(ran ? `Applied ${ran} migration(s).` : 'Database is up to date.')
  } finally {
    await client.end()
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('db-migrate.mjs')) {
  main().catch((e) => { console.error(e.message); process.exit(1) })
}
