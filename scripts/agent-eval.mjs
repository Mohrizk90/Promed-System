#!/usr/bin/env node
/**
 * Agent evaluation with the real model against the real database — nothing is kept.
 *
 *   npm run agent:eval                       all cases, default model
 *   npm run agent:eval -- --model gemini-4-argon
 *   npm run agent:eval -- --only fuel,rent
 *
 * Each case runs inside a savepoint of one transaction that is rolled back at the end,
 * acting as the owner (same row rules as the live app).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { connectionConfig, loadEnvFile } from './db-migrate.mjs'
import { pgDb } from '../api/_lib/agent/db.js'
import { runAgent } from '../api/_lib/agent/run.js'
import { getGoogle, MODELS } from '../api/_lib/agent/models.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
loadEnvFile(path.join(root, '.env.local'))
if (process.env.GEMINI_API_KEY_PROMED) process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY_PROMED
const OWNER = process.env.TEST_OWNER_ID || 'bb88be0d-6696-4d62-9628-c4e6825f911c'
const argv = process.argv.slice(2)
const model = argv.includes('--model') ? argv[argv.indexOf('--model') + 1] : MODELS.main
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null
const verbose = argv.includes('--verbose')

const client = new pg.Client(connectionConfig())
await client.connect()
const q = async (sql, params) => (await client.query(sql, params)).rows
const db = pgDb(client)

/** Runs one user turn; returns { text, calls: [{tool, input, output}] } */
async function turn(text, { conversationId = null, history = [], voiceText = null } = {}) {
  const messages = [...history, { id: `u${Date.now()}`, role: 'user', parts: [{ type: 'text', text }] }]
  const started = Date.now()
  const result = await runAgent({ db, getGoogle, messages, conversationId, voiceText, model, locale: 'ar' })
  const steps = await result.steps
  const calls = steps.flatMap((s) => s.toolResults.map((r) => ({ tool: r.toolName, input: r.input, output: r.output })))
  return { text: await result.text, calls, ms: Date.now() - started, usage: await result.totalUsage }
}

const saved = (r, tool) => r.calls.filter((c) => (!tool || c.tool === tool) && c.output?.status === 'saved')
const pending = (r, tool) => r.calls.filter((c) => (!tool || c.tool === tool) && c.output?.status === 'pending')
const writes = (r) => r.calls.filter((c) => c.output?.status === 'saved' || c.output?.status === 'pending')
function expect(cond, msg) { if (!cond) throw new Error(msg) }

async function newConversation() {
  return (await q(`insert into agent_conversations (title) values ('eval') returning id`))[0].id
}

// Real names from the data so the cases are realistic.
await client.query('begin')
for (const f of fs.readdirSync(path.join(root, 'db', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) {
  const done = await q('select 1 from app_migrations where name = $1', [f])
  if (!done.length) await client.query(fs.readFileSync(path.join(root, 'db', 'migrations', f), 'utf8'))
}
await client.query(`set local role authenticated`)
await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: OWNER, role: 'authenticated' })])
const topClient = (await q(`select client_id, client_name, balance from client_balances() order by balance desc limit 1`))[0]
const someClient = (await q(`select client_id, client_name from clients where client_name ~ '[A-Za-z؀-ۿ]{4,}' order by client_id limit 1`))[0]
const someProduct = (await q(`select product_id, product_name from products order by product_id limit 1`))[0]

const cases = [
  {
    id: 'fuel', say: 'دفعت 350 جنيه بنزين للعربية النهارده',
    check: async (r) => {
      const s = saved(r, 'record_money')
      expect(s.length === 1, 'should auto-save one record_money')
      const e = (await q(`select * from v_ledger where id = $1`, [s[0].output.result.entries[0].id]))[0]
      expect(Number(e.amount) === 350 && e.kind === 'expense', `amount/kind wrong: ${e.amount} ${e.kind}`)
      expect(e.category_en === 'Fuel', `category should be Fuel, got ${e.category_en}`)
      expect(JSON.stringify(e.projects).includes('Company car'), `should link to Company car, got ${JSON.stringify(e.projects)}`)
    },
  },
  {
    id: 'multi', say: 'صرفت 200 أكل للعمال و 1500 للمخلص على شحنة الصين الجديدة',
    check: async (r) => {
      const all = [...saved(r, 'record_money'), ...pending(r, 'record_money')]
      expect(all.length >= 1, 'should record money')
      const entries = all.flatMap((c) => c.input.entries)
      expect(entries.length === 2, `should be two entries, got ${entries.length}`)
      const customs = entries.find((e) => Number(e.amount) === 1500)
      expect(customs, 'missing the 1500 entry')
      expect((customs.links || []).some((l) => l.new_project || l.project_id), 'customs should be linked to the shipment')
      const link = (customs.links || [])[0]
      if (link?.new_project) expect((link.new_project_type || '') === 'shipment', `new project type should be shipment, got ${link.new_project_type}`)
    },
  },
  {
    id: 'rent', say: 'حولت 12 ألف إيجار المكتب الشهر ده',
    check: async (r) => {
      const p = pending(r, 'record_money')
      expect(p.length === 1 && saved(r).length === 0, 'over the limit -> must wait for confirm')
      const e = p[0].input.entries[0]
      expect(Number(e.amount) === 12000, `amount should be 12000, got ${e.amount}`)
      const cat = (await q(`select name_en from categories where id = $1`, [e.category_id]))[0]
      expect(cat?.name_en === 'Rent', `category should be Rent, got ${cat?.name_en}`)
      const acc = e.account_id ? (await q(`select kind from money_accounts where id = $1`, [e.account_id]))[0] : null
      expect(acc?.kind === 'bank', 'حولت -> bank account')
    },
  },
  {
    id: 'client_payment', say: `${someClient.client_name} دفع 3000 كاش`,
    check: async (r) => {
      const c = [...saved(r, 'receive_client_payment'), ...pending(r, 'receive_client_payment')]
      expect(c.length === 1, `should record one client payment (calls: ${r.calls.map((x) => x.tool).join(',')})`)
      expect(c[0].input.client_id === someClient.client_id, `wrong client ${c[0].input.client_id} vs ${someClient.client_id}`)
      expect(Number(c[0].input.amount) === 3000, 'amount 3000')
      expect(saved(r, 'record_money').length === 0, 'must not also record it as income')
    },
  },
  {
    id: 'top_debtor', say: 'مين أكتر عميل عليه فلوس؟',
    check: async (r) => {
      expect(writes(r).length === 0, 'a question must not write')
      const firstWord = topClient.client_name.split(/\s+/)[0]
      expect(r.text.includes(firstWord), `answer should name ${topClient.client_name}`)
    },
  },
  {
    id: 'sale', say: `سجل بيع 2 ${someProduct.product_name} ل ${someClient.client_name} بسعر 1000 للواحد`,
    check: async (r) => {
      const c = [...saved(r, 'record_sale'), ...pending(r, 'record_sale')]
      expect(c.length === 1, 'should record a sale')
      expect(c[0].input.client_id === someClient.client_id, 'right client')
      const l = c[0].input.lines[0]
      expect(Number(l.quantity) === 2 && Number(l.unit_price) === 1000, 'line 2 x 1000')
      expect(l.product_id === someProduct.product_id, `should reuse product ${someProduct.product_id}, got ${l.product_id ?? l.product_name}`)
      expect(Number(c[0].output.result?.total ?? c[0].output.preview?.total) === 2280, 'total with 14% VAT = 2280')
    },
  },
  {
    id: 'undo', setup: async () => {
      const conv = await newConversation()
      const id = await db.rpc('agent_stage', { p_kind: 'record_entries', p_summary: 'بنزين 400', p_payload: { entries: [{ kind: 'expense', amount: 400, description: 'بنزين' }] }, p_conversation: conv })
      const res = await db.rpc('agent_commit', { p_action: id })
      return { conversationId: conv, actionId: id, entryId: res.entries[0].id }
    },
    say: 'لا استنى امسح البنزين اللي لسه مسجله ده',
    check: async (r, s) => {
      const u = r.calls.find((c) => c.tool === 'undo_action')
      expect(u, `should call undo_action (calls: ${r.calls.map((x) => x.tool).join(',')})`)
      expect(u.input.action_id === s.actionId, 'should undo the right action')
      expect(!(await q(`select 1 from ledger_entries where id = $1`, [s.entryId])).length, 'entry removed')
    },
  },
  {
    id: 'general', say: 'كام نسبة ضريبة القيمة المضافة في مصر؟',
    check: async (r) => {
      expect(writes(r).length === 0, 'no writes')
      expect(/14|١٤/.test(r.text), 'should say 14%')
    },
  },
  {
    id: 'unknown_person', say: 'دفعت 500 لسمير',
    check: async (r) => {
      const s = saved(r)
      const bad = s.find((c) => c.input?.entries?.some((e) => e.client_id || e.supplier_id || e.employee_id))
      expect(!bad, 'must not attach an unknown person to an existing client/supplier/employee')
      expect(s.length === 0 || r.text.length > 0, 'ok')
    },
  },
  {
    id: 'english', say: 'Paid 2,500 for shipping, put it on the Office',
    check: async (r) => {
      const c = [...saved(r, 'record_money'), ...pending(r, 'record_money')]
      expect(c.length === 1, 'record_money')
      const e = c[0].input.entries[0]
      expect(Number(e.amount) === 2500, 'amount')
      const cat = (await q(`select name_en from categories where id = $1`, [e.category_id]))[0]
      expect(cat?.name_en === 'Shipping & freight', `category, got ${cat?.name_en}`)
      const office = (await q(`select id from projects where name = 'Office'`))[0].id
      expect((e.links || []).some((l) => l.project_id === office), 'linked to Office')
      expect(!/[؀-ۿ]/.test(r.text), 'English reply')
    },
  },
  {
    id: 'balance_q', say: `${someClient.client_name} عليه كام؟`,
    check: async (r) => {
      expect(writes(r).length === 0, 'no writes')
      expect(r.calls.some((c) => c.tool === 'client_account' || c.tool === 'balances' || c.tool === 'query_data'), 'should look it up')
    },
  },
  {
    id: 'report', say: 'اعرضلي مصاريف الشهر ده متقسمة على التصنيفات',
    check: async (r) => {
      expect(writes(r).length === 0, 'no writes')
      expect(r.calls.some((c) => ['money_report', 'show_table', 'show_chart', 'query_data'].includes(c.tool)), 'should run a report')
    },
  },
]

let pass = 0
const results = []
console.log(`Model: ${model}\n`)
for (const c of cases) {
  if (only && !only.includes(c.id)) continue
  await client.query('savepoint c')
  try {
    const s = c.setup ? await c.setup() : {}
    const r = await turn(c.say, { conversationId: s.conversationId || (await newConversation()) })
    if (verbose) console.log(JSON.stringify(r.calls, null, 1).slice(0, 3000), '\n', r.text)
    await c.check(r, s)
    pass++
    results.push({ id: c.id, ok: true, ms: r.ms, tokens: r.usage?.totalTokens })
    console.log(`  ✓ ${c.id.padEnd(15)} ${String(r.ms).padStart(6)} ms  | ${r.text.replace(/\s+/g, ' ').slice(0, 110)}`)
  } catch (e) {
    results.push({ id: c.id, ok: false, error: e.message })
    console.log(`  ✗ ${c.id.padEnd(15)} ${e.message}`)
  } finally {
    await client.query('rollback to savepoint c')
  }
}
await client.query('rollback')
await client.end()
const total = results.length
const avg = Math.round(results.filter((r) => r.ms).reduce((s, r) => s + r.ms, 0) / Math.max(1, results.filter((r) => r.ms).length))
console.log(`\n${pass}/${total} passed on ${model} · avg ${avg} ms per turn (everything rolled back)`)
fs.mkdirSync(path.join(root, 'test-results'), { recursive: true })
fs.writeFileSync(path.join(root, 'test-results', `agent-eval-${model}.json`), JSON.stringify({ model, pass, total, avg, results }, null, 2))
process.exit(pass === total ? 0 : 1)
