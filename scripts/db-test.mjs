#!/usr/bin/env node
/**
 * Database tests that are safe to run against the real database.
 *
 *   npm run db:test
 *
 * Everything runs inside ONE transaction that is always rolled back: pending migrations are
 * applied first (so new SQL can be tested before it ships), then every db/tests/*.sql file runs
 * as a logged-in member. Test files use `assert` / `raise notice 'PASS …'` inside DO blocks.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { connectionConfig } from './db-migrate.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OWNER = process.env.TEST_OWNER_ID || 'bb88be0d-6696-4d62-9628-c4e6825f911c'

const client = new pg.Client(connectionConfig())
const notices = []
client.on('notice', (n) => notices.push(n.message))

let failed = 0
let passed = 0
await client.connect()
try {
  await client.query('begin')
  const applied = new Set((await client.query('select name from public.app_migrations')).rows.map((r) => r.name))
  for (const f of fs.readdirSync(path.join(root, 'db', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) {
    if (applied.has(f)) continue
    process.stdout.write(`(applying pending ${f} for the test run) `)
    await client.query(fs.readFileSync(path.join(root, 'db', 'migrations', f), 'utf8'))
    console.log('ok')
  }
  const testDir = path.join(root, 'db', 'tests')
  for (const f of fs.readdirSync(testDir).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(testDir, f), 'utf8').replaceAll('{{OWNER}}', OWNER)
    // Split on a line containing only "-- test" so one failing test doesn't hide the others.
    const chunks = sql.split(/^--\s*test\b.*$/m).map((s) => s.trim()).filter(Boolean)
    for (const chunk of chunks) {
      notices.length = 0
      await client.query('savepoint t')
      try {
        await client.query(chunk)
        await client.query('release savepoint t')
        const pass = notices.filter((m) => m.startsWith('PASS'))
        passed += pass.length
        for (const m of pass) console.log(`  ✓ ${m.slice(5)}`)
      } catch (e) {
        await client.query('rollback to savepoint t')
        failed++
        const first = chunk.split('\n').find((l) => l.includes('PASS')) || chunk.slice(0, 80)
        console.log(`  ✗ ${f}: ${e.message}\n      in: ${first.trim().slice(0, 120)}`)
      }
      await client.query('reset role')
    }
  }
} finally {
  await client.query('rollback').catch(() => {})
  await client.end()
}
console.log(`\n${passed} passed, ${failed} failed (everything rolled back)`)
process.exit(failed ? 1 : 0)
