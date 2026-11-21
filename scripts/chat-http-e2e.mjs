#!/usr/bin/env node
/**
 * End-to-end check of POST /api/agent/chat and POST /api/agent/action over real HTTP:
 * the real handlers on a local server, the real model, the real database acting as the
 * owner — inside one transaction that is rolled back. Only sign-in is stubbed.
 *
 *   node scripts/chat-http-e2e.mjs
 */
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { register } from 'node:module'
import pg from 'pg'
import { connectionConfig, loadEnvFile } from './db-migrate.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
loadEnvFile(path.join(root, '.env.local'))
if (process.env.GEMINI_API_KEY_PROMED) process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY_PROMED
const OWNER = process.env.TEST_OWNER_ID || 'bb88be0d-6696-4d62-9628-c4e6825f911c'

const client = new pg.Client(connectionConfig())
await client.connect()
await client.query('begin')
await client.query('set local role authenticated')
await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: OWNER, role: 'authenticated' })])

const { pgDb } = await import('../api/_lib/agent/db.js')
const pgRpc = pgDb(client)

// A tiny Supabase-shaped client over the transaction (rpc + the two upserts chat.js does).
const saved = []
const userClient = {
  rpc: async (fn, args) => {
    try { return { data: await pgRpc.rpc(fn, args), error: null } } catch (e) { return { data: null, error: { message: e.message } } }
  },
  from: (table) => ({
    select: (cols) => ({
      eq: (col, val) => ({
        maybeSingle: async () => {
          if (table !== 'agent_actions' || !/^[a-z_, ]+$/.test(cols) || col !== 'id') throw new Error('unsupported in test stub')
          return { data: (await client.query(`select ${cols} from agent_actions where id = $1`, [val])).rows[0] || null, error: null }
        },
      }),
    }),
    upsert: async (rows) => {
      const list = Array.isArray(rows) ? rows : [rows]
      for (const r of list) {
        if (table === 'agent_conversations') {
          await client.query(`insert into agent_conversations (id, user_id, title) values ($1, $2, $3) on conflict (id) do update set title = excluded.title`, [r.id, r.user_id, r.title])
        } else if (table === 'agent_messages') {
          await client.query(`insert into agent_messages (conversation_id, message_id, role, parts) values ($1, $2, $3, $4) on conflict (conversation_id, message_id) do update set parts = excluded.parts`, [r.conversation_id, r.message_id, r.role, JSON.stringify(r.parts)])
          saved.push(r)
        }
      }
      return { error: null }
    },
  }),
}
globalThis.__PROMED_TEST_AUTH__ = { user: { id: OWNER, email: 'owner@test' }, userClient }

// Swap the auth module for one that returns the stub above.
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.endsWith('/_lib/auth.js') && !ctx.parentURL?.startsWith('data:')) return { url: 'data:text/javascript,' + encodeURIComponent(
    "export class HttpError extends Error { constructor(s, m) { super(m); this.status = s } }\\n" +
    "export async function authenticateRequest() { return globalThis.__PROMED_TEST_AUTH__ }"), shortCircuit: true }
  return next(spec, ctx)
}`), import.meta.url)

const chat = (await import('../api/agent/chat.js')).default
const action = (await import('../api/agent/action.js')).default
const routes = { '/api/agent/chat': chat, '/api/agent/action': action }
const server = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  req.body = raw ? JSON.parse(raw) : {}
  const r = res
  r.status = (code) => { r.statusCode = code; return r }
  r.json = (obj) => { r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify(obj)) }
  routes[req.url](req, r)
})
await new Promise((ok) => server.listen(0, ok))
const base = `http://127.0.0.1:${server.address().port}`

let failures = 0
const check = (cond, msg) => { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) failures++ }

try {
  const conversationId = crypto.randomUUID()
  console.log('Turn 1 — voice-style entry over HTTP (stream)')
  const t0 = Date.now()
  const res = await fetch(`${base}/api/agent/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: conversationId, locale: 'ar', page: '/money', voiceText: 'دفعت 180 جنيه مواصلات النهارده',
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'دفعت 180 جنيه مواصلات النهارده' }], metadata: { voice: true } }],
    }),
  })
  check(res.status === 200, `HTTP 200 (got ${res.status})`)
  check(/text\/event-stream/.test(res.headers.get('content-type') || ''), 'streams server-sent events')
  const body = await res.text()
  const events = body.split('\n').filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]').map((l) => JSON.parse(l.slice(6)))
  const out = events.find((e) => e.type === 'tool-output-available' && e.output?.status)
  check(events.some((e) => e.type === 'text-delta'), 'streams reply text')
  check(out?.output?.status === 'saved', `small entry auto-saved (status: ${out?.output?.status})`)
  check(out?.output?.details?.type === 'entries', 'card details included')
  console.log(`    ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  await new Promise((ok) => setTimeout(ok, 300))
  check(saved.length === 2 && saved[1].role === 'assistant', 'conversation saved (user + assistant)')
  const actionId = out?.output?.action_id
  const entry = (await client.query(`select e.amount, e.voice_text, e.source from agent_changes c join ledger_entries e on e.id = c.pk_val::bigint where c.action_id = $1 and c.table_name = 'ledger_entries'`, [actionId])).rows[0]
  check(Number(entry?.amount) === 180 && entry?.source === 'agent', 'ledger entry written with source = agent')

  console.log('Turn 2 — undo over HTTP')
  const u = await fetch(`${base}/api/agent/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'undo', actionId }) })
  const uj = await u.json()
  check(u.status === 200 && uj.action?.status === 'undone', `undo returns undone (got ${u.status} ${uj.action?.status || uj.error})`)
  const left = (await client.query(`select count(*)::int n from ledger_entries e join agent_changes c on e.id = c.pk_val::bigint and c.table_name = 'ledger_entries' where c.action_id = $1 and e.deleted_at is null`, [actionId])).rows[0].n
  check(left === 0, 'entry gone after undo')

  console.log('Turn 3 — big amount waits for Confirm, then confirm over HTTP')
  const r3 = await fetch(`${base}/api/agent/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: conversationId, locale: 'ar', messages: [{ id: 'u3', role: 'user', parts: [{ type: 'text', text: 'دفعت إيجار المكتب 9000 جنيه' }] }] }),
  })
  const ev3 = (await r3.text()).split('\n').filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]').map((l) => JSON.parse(l.slice(6)))
  const out3 = ev3.find((e) => e.type === 'tool-output-available' && e.output?.status)
  check(out3?.output?.status === 'pending' && out3?.output?.why_code === 'limit', `9,000 waits (status: ${out3?.output?.status}, why: ${out3?.output?.why_code})`)
  const c = await fetch(`${base}/api/agent/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'confirm', actionId: out3?.output?.action_id }) })
  const cj = await c.json()
  check(cj.action?.status === 'applied', `confirm applies it (got ${cj.action?.status || cj.error})`)

  console.log('Broken Gemini key → clear error code, not a generic failure')
  const goodKey = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = 'AIzaSy-not-a-real-key-for-testing-000000'
  try {
    const rk = await fetch(`${base}/api/agent/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: 'ar', messages: [{ id: 'u9', role: 'user', parts: [{ type: 'text', text: 'ازيك' }] }] }),
    })
    const raw = await rk.text()
    check(/AGENT_ERROR:key_invalid/.test(raw), `stream says key_invalid (got ${(raw.match(/AGENT_ERROR:\w+/) || [rk.status])[0]})`)
    const hk = await (await fetch(`${base}/api/agent/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'health' }) })).json()
    check(hk.ok === false && hk.code === 'key_invalid', `health check reports key_invalid (got ${hk.code})`)
  } finally {
    process.env.GEMINI_API_KEY = goodKey
  }
  const hg = await (await fetch(`${base}/api/agent/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'health' }) })).json()
  check(hg.ok === true && hg.models.every((m) => m.ok), `health check passes with the real key (${hg.models.map((m) => m.role).join(', ')})`)

  console.log('Bad request')
  const bad = await fetch(`${base}/api/agent/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [] }) })
  check(bad.status === 400, 'empty messages → 400')
} finally {
  await client.query('rollback')
  await client.end()
  server.close()
}
console.log(failures ? `\n${failures} check(s) failed (everything rolled back)` : '\nAll HTTP checks passed (everything rolled back)')
process.exit(failures ? 1 : 0)
