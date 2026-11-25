// Every capability the agent has. Reads run directly; writes go through
// dry run -> stage -> (auto-save when the policy allows, otherwise wait for Confirm).
import { generateText, tool } from 'ai'
import { z } from 'zod'
import { amountOf, decideAutoSave } from './policy.js'
import { MODELS } from './models.js'

export const PAGES = {
  dashboard: '/dashboard',
  sales: '/',
  purchases: '/suppliers',
  invoices: '/invoices',
  clients: '/entities/clients',
  suppliers: '/entities/suppliers',
  employees: '/entities/employees',
  products: '/products',
  liabilities: '/liabilities',
  money: '/money',
  projects: '/projects',
  project: '/projects/:id',
  boms: '/boms',
  bom: '/boms?id=:id',
  agent_activity: '/agent',
  aging_report: '/reports/aging',
  profit_loss: '/reports/pnl',
  compliance: '/compliance',
  compliance_item: '/compliance/item/:id',
  compliance_document_review: '/compliance/review-orphan/:id',
  settings: '/settings',
}

const CREATABLE = ['clients', 'suppliers', 'products', 'employees', 'inventory_items', 'liabilities', 'liability_payments',
  'compliance_items', 'compliance_item_expenses', 'categories', 'money_accounts', 'boms', 'bom_lines', 'record_links']
const EDITABLE = ['clients', 'suppliers', 'products', 'employees', 'inventory_items', 'liabilities', 'liability_payments',
  'client_transactions', 'supplier_transactions', 'payments', 'compliance_items', 'compliance_item_expenses', 'ledger_entries',
  'projects', 'project_types', 'categories', 'money_accounts', 'record_links', 'boms', 'bom_lines']
const SEARCH_KINDS = ['client', 'supplier', 'product', 'project', 'category', 'account', 'employee', 'compliance_item', 'project_type']
const RECORD_TYPES = ['ledger_entry', 'client_transaction', 'supplier_transaction', 'payment', 'liability', 'compliance_item',
  'inventory_item', 'product', 'bom']

const dateStr = z.string().describe('YYYY-MM-DD')
const summaryField = z.string().describe('One short line describing the change in the language the owner used, e.g. "بنزين 350 ج للعربية"')
const confidentField = z.boolean().describe('false if you guessed any important detail (who, which project, amount, date). Unsure entries wait for Confirm.')

function parseJsonObject(text, field) {
  if (text === undefined || text === null || text === '') return {}
  try {
    const v = typeof text === 'string' ? JSON.parse(text) : text
    if (v && typeof v === 'object' && !Array.isArray(v)) return v
  } catch { /* fall through */ }
  throw new Error(`${field} must be a JSON object, e.g. {"contact_info":"0100..."}`)
}

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''))

/**
 * @param {object} ctx
 * @param {{rpc: Function}} ctx.db
 * @param {string|null} ctx.conversationId
 * @param {string|null} ctx.voiceText
 * @param {{auto_save_limit?: number}} ctx.settings
 * @param {Function} [ctx.getGoogle]       for web search
 * @param {Function} [ctx.extractDocument] (documentId) => extraction payload (compliance scanner)
 */
export function createTools(ctx) {
  const { db } = ctx
  const rpc = (fn, args) => db.rpc(fn, args)
  const ask = (sql) => rpc('agent_ask_data', { p_sql: sql })
  const sqlNum = (v) => {
    const n = Number(v)
    if (!Number.isFinite(n)) throw new Error('Expected a number')
    return n
  }
  const sqlText = (v) => `'${String(v).replace(/'/g, "''")}'`

  async function write(kind, summary, payload, { confident = true } = {}) {
    const dry = await rpc('agent_dry_run', { p_kind: kind, p_payload: payload })
    if (!dry?.ok) {
      return { status: 'error', error: dry?.error || 'Could not prepare this change', note: 'Nothing was saved. Fix the details or ask the owner.' }
    }
    const preview = dry.result
    let details = null
    try { details = await describe(kind, payload, preview) } catch { /* the card falls back to the summary */ }
    const actionId = await rpc('agent_stage', {
      p_kind: kind, p_summary: summary, p_payload: payload, p_preview: preview,
      p_conversation: ctx.conversationId || null, p_voice: ctx.voiceText || null,
    })
    const amount = amountOf(kind, payload, preview)
    const decision = decideAutoSave({ kind, payload, amount, confident, limit: ctx.settings?.auto_save_limit })
    const why = { why: decision.reason, why_code: decision.code, why_amount: amount, why_limit: Number(ctx.settings?.auto_save_limit ?? 5000) }
    if (decision.save) {
      try {
        const result = await rpc('agent_commit', { p_action: actionId })
        return { status: 'saved', action_id: actionId, kind, summary, details, result, ...why }
      } catch (e) {
        await rpc('agent_mark_failed', { p_action: actionId, p_error: e.message }).catch(() => {})
        return { status: 'error', action_id: actionId, error: e.message }
      }
    }
    return {
      status: 'pending', action_id: actionId, kind, summary, details, preview, ...why,
      note: 'The owner sees this with Confirm / Cancel buttons. Do not ask for confirmation in text.',
    }
  }

  // Human-readable card content (names instead of ids) for the Confirm / Undo card.
  async function names(table, idCol, nameCol, ids) {
    const list = [...new Set(ids.filter((v) => v !== undefined && v !== null && v !== '').map(Number).filter(Number.isFinite))]
    if (!list.length) return new Map()
    const rows = await ask(`select ${idCol} as id, ${nameCol} as n from ${table} where ${idCol} in (${list.join(',')})`)
    return new Map(rows.map((r) => [Number(r.id), r.n]))
  }
  async function describe(kind, payload, preview) {
    const lists = ctx.lists || {}
    const cats = new Map((lists.categories || []).map((c) => [c.id, c]))
    const accs = new Map((lists.accounts || []).map((a) => [a.id, a.name]))
    if (kind === 'record_entries') {
      const entries = payload.entries || []
      const links = entries.flatMap((e) => e.links || [])
      const [projects, clients, suppliers, employees] = await Promise.all([
        names('projects', 'id', 'name', links.map((l) => l.project_id)),
        names('clients', 'client_id', 'client_name', entries.map((e) => e.client_id)),
        names('suppliers', 'supplier_id', 'supplier_name', entries.map((e) => e.supplier_id)),
        names('employees', 'employee_id', 'name', entries.map((e) => e.employee_id)),
      ])
      const lines = entries.map((e) => {
        const c = cats.get(e.category_id)
        return {
          kind: e.kind, amount: Number(e.amount), date: e.entry_date || lists.today,
          category: c ? { en: c.en, ar: c.ar } : e.new_category ? { en: e.new_category, ar: e.new_category_ar || e.new_category, isNew: true } : null,
          account: accs.get(e.account_id) || e.new_account || null,
          party: e.party_name || clients.get(e.client_id) || suppliers.get(e.supplier_id) || employees.get(e.employee_id) || null,
          description: e.description || null,
          projects: (e.links || []).map((l) => ({
            name: l.project_id ? projects.get(l.project_id) || `#${l.project_id}` : l.new_project,
            isNew: !l.project_id, type: l.new_project_type || null, share: Number(l.share_pct ?? 100),
          })),
        }
      })
      return { type: 'entries', lines, total: lines.reduce((s2, l) => s2 + l.amount, 0) }
    }
    if (kind === 'client_payment' || kind === 'supplier_payment') {
      const isClient = kind === 'client_payment'
      const who = isClient
        ? (await names('clients', 'client_id', 'client_name', [payload.client_id])).get(Number(payload.client_id))
        : (await names('suppliers', 'supplier_id', 'supplier_name', [payload.supplier_id])).get(Number(payload.supplier_id))
      const covers = isClient ? (preview?.allocations || []) : (preview?.payments || []).filter((p) => p.transaction_id)
      return {
        type: 'payment', direction: isClient ? 'in' : 'out', party: who, amount: Number(payload.amount), date: payload.payment_date || lists.today,
        method: payload.payment_method || 'cash',
        covers: covers.map((a) => ({ invoice: a.invoice_number || `#${a.transaction_id}`, amount: Number(a.allocated) })),
        left_over: Number(isClient ? preview?.unallocated_credit || 0 : preview?.advance || 0),
      }
    }
    if (kind === 'record_sale' || kind === 'record_purchase') {
      const isSale = kind === 'record_sale'
      const lines = isSale ? payload.lines || [] : [payload]
      const products = await names('products', 'product_id', 'product_name', lines.map((l) => l.product_id))
      const who = isSale
        ? (await names('clients', 'client_id', 'client_name', [payload.client_id])).get(Number(payload.client_id))
        : (await names('suppliers', 'supplier_id', 'supplier_name', [payload.supplier_id])).get(Number(payload.supplier_id))
      return {
        type: isSale ? 'sale' : 'purchase', party: who, date: payload.transaction_date || lists.today,
        lines: lines.map((l) => ({ product: products.get(Number(l.product_id)) || l.product_name, isNew: !l.product_id, quantity: Number(l.quantity), unit_price: Number(l.unit_price) })),
        subtotal: Number(preview?.subtotal ?? preview?.total ?? 0), vat: Number(preview?.vat || 0), wht: Number(preview?.wht || 0),
        total: Number(preview?.total || 0), paid: Number(preview?.paid || 0), remaining: Number(preview?.remaining || 0),
      }
    }
    if (kind === 'update_record') {
      const before = preview?.before || {}
      return {
        type: 'update', table: payload.table, id: payload.id,
        changes: Object.entries(payload.values || {}).map(([field, to]) => ({ field, from: before[field] ?? null, to })),
      }
    }
    if (kind === 'delete_record') return { type: 'delete', table: payload.table, id: payload.id, record: preview?.deleted || null }
    if (kind === 'create_record') return { type: 'create', table: payload.table, values: payload.values, record: preview?.record || null }
    if (kind === 'link_records') {
      const projects = await names('projects', 'id', 'name', (payload.links || []).map((l) => l.project_id))
      return { type: 'links', links: (payload.links || []).map((l) => ({ record_type: l.record_type, record_id: l.record_id, project: projects.get(Number(l.project_id)) || l.new_project, share: Number(l.share_pct ?? 100) })) }
    }
    return null
  }

  const tools = {
    // ------------------------------------------------------------------ finding things
    find: tool({
      description: 'Find clients, suppliers, products, projects, categories, money accounts, employees, compliance items or project types by name (Arabic or English, partial, misspelled). Always use this to get IDs before writing.',
      inputSchema: z.object({
        query: z.string(),
        kinds: z.array(z.enum(SEARCH_KINDS)).optional().describe('Limit to these kinds'),
      }),
      execute: async ({ query, kinds }) => {
        const rows = await rpc('agent_search', { p_q: query, p_kinds: kinds?.length ? kinds : null, p_limit: 5 })
        return { matches: rows.map((r) => ({ ...r, score: Math.round(r.score * 100) / 100 })) }
      },
    }),

    client_account: tool({
      description: 'A client\'s balance, open invoices (correct FIFO view, same as the Clients screen) and last payments.',
      inputSchema: z.object({ client_id: z.number().int() }),
      execute: async ({ client_id }) => {
        const id = sqlNum(client_id)
        const [balance] = await rpc('client_balances', { p_client: id })
        const invoices = await rpc('client_invoice_status', { p_client: id })
        const payments = await ask(`select payment_id, payment_date, payment_amount, payment_method, transaction_id from payments where transaction_type = 'client' and client_id = ${id} order by payment_date desc, payment_id desc limit 8`)
        return { balance, open_invoices: invoices.filter((i) => Number(i.remaining) > 0), last_payments: payments }
      },
    }),

    supplier_account: tool({
      description: 'A supplier\'s balance, open purchases and last payments.',
      inputSchema: z.object({ supplier_id: z.number().int() }),
      execute: async ({ supplier_id }) => {
        const id = sqlNum(supplier_id)
        const [balance] = await rpc('supplier_balances', { p_supplier: id })
        const open = await ask(`select transaction_id, transaction_date, invoice_number, total_amount, paid_amount, remaining_amount, status from supplier_transactions where supplier_id = ${id} and remaining_amount > 0 order by transaction_date`)
        const payments = await ask(`select payment_id, payment_date, payment_amount, payment_method, transaction_id from payments where transaction_type = 'supplier' and supplier_id = ${id} order by payment_date desc, payment_id desc limit 8`)
        return { balance, open_purchases: open, last_payments: payments }
      },
    }),

    balances: tool({
      description: 'Who owes us (clients) or whom we owe (suppliers), largest first.',
      inputSchema: z.object({ side: z.enum(['clients', 'suppliers']), limit: z.number().int().optional() }),
      execute: async ({ side, limit }) => {
        const rows = await rpc(side === 'clients' ? 'client_balances' : 'supplier_balances', {})
        const list = rows.filter((r) => Math.abs(Number(r.balance)) > 0.005).sort((a, b) => Number(b.balance) - Number(a.balance))
        return { total: list.reduce((s, r) => s + Number(r.balance), 0), rows: list.slice(0, limit || 15), count: list.length }
      },
    }),

    money_report: tool({
      description: 'Income and expenses (general ledger) totals for a period, grouped by category, project, month, day, account, party or kind.',
      inputSchema: z.object({
        from: dateStr.optional(), to: dateStr.optional(),
        group_by: z.enum(['category', 'project', 'month', 'day', 'account', 'party', 'kind']).optional(),
        kind: z.enum(['expense', 'income']).optional(),
        project_id: z.number().int().optional(),
      }),
      execute: async (a) => rpc('ledger_report', {
        p_from: a.from || null, p_to: a.to || null, p_group: a.group_by || 'category', p_kind: a.kind || null, p_project: a.project_id ?? null,
      }),
    }),

    list_projects: tool({
      description: 'Projects (deals, shipments, devices, BOMs, cost centers...) with income, expense and net.',
      inputSchema: z.object({
        status: z.enum(['active', 'on_hold', 'done', 'cancelled', 'all']).optional(),
        type_key: z.string().optional(),
        search: z.string().optional(),
      }),
      execute: async ({ status, type_key, search }) => {
        const where = ['true']
        if (status && status !== 'all') where.push(`status = ${sqlText(status)}`)
        else if (!status) where.push(`status in ('active','on_hold')`)
        if (type_key) where.push(`type_key = ${sqlText(type_key)}`)
        if (search) where.push(`norm_text(name) like '%' || norm_text(${sqlText(search)}) || '%'`)
        return { projects: await ask(`select project_id, name, type_key, status, budget, income, expense, net, records, last_activity from v_project_totals where ${where.join(' and ')} order by last_activity desc nulls last, project_id desc limit 60`) }
      },
    }),

    project_details: tool({
      description: 'Everything about one project: totals, custom fields, linked records, by-category breakdown.',
      inputSchema: z.object({ project_id: z.number().int() }),
      execute: async ({ project_id }) => rpc('project_overview', { p_project: project_id }),
    }),

    business_snapshot: tool({
      description: 'Headline numbers: receivables, payables, this month income/expense, overdue invoices, liabilities due, compliance expiring.',
      inputSchema: z.object({}),
      execute: async () => rpc('dashboard_snapshot', {}),
    }),

    query_data: tool({
      description: 'Run ONE read-only SQL SELECT over the business tables (schema in your instructions) for questions the other tools do not cover. Max 200 rows. Use norm_text() for name matching.',
      inputSchema: z.object({ sql: z.string(), purpose: z.string().describe('What you are trying to find out') }),
      execute: async ({ sql }) => {
        try {
          const rows = await ask(sql)
          return { rows, count: rows.length }
        } catch (e) {
          return { error: e.message, note: 'Fix the SQL and try again (only SELECT/WITH, existing columns).' }
        }
      },
    }),

    recent_actions: tool({
      description: 'What the agent saved, is waiting on, or undid recently (with action ids for undo).',
      inputSchema: z.object({ limit: z.number().int().optional(), this_conversation_only: z.boolean().optional() }),
      execute: async ({ limit, this_conversation_only }) => ({
        actions: await rpc('agent_recent_actions', { p_conversation: this_conversation_only ? ctx.conversationId : null, p_limit: limit || 15 }),
      }),
    }),

    compliance_overview: tool({
      description: 'Licences / certificates / registrations: expired, expiring soon, and documents waiting for review.',
      inputSchema: z.object({ days_ahead: z.number().int().optional() }),
      execute: async ({ days_ahead }) => {
        const d = Math.min(Math.max(Number(days_ahead) || 60, 1), 730)
        const [expiring, expired, review] = await Promise.all([
          ask(`select i.id, i.title, i.status, i.priority, i.expiry_date, a.name as authority from compliance_items i left join compliance_authorities a on a.id = i.authority_id where i.expiry_date between current_date and current_date + ${d} and i.status <> 'archived' order by i.expiry_date`),
          ask(`select i.id, i.title, i.status, i.expiry_date from compliance_items i where i.expiry_date < current_date and i.status <> 'archived' order by i.expiry_date`),
          ask(`select id, file_name, document_type, ai_summary, processing_status, created_at from compliance_item_documents where processing_status in ('waiting_for_review','uploaded','queued','ocr_processing','failed') and coalesce(is_current_version, true) order by created_at desc limit 20`),
        ])
        return { expiring_within_days: d, expiring, expired, documents_waiting: review }
      },
    }),

    // ------------------------------------------------------------------ recording money
    record_money: tool({
      description: 'Record one or more general expenses or income (fuel, rent, salaries, customs, shipping, service income...). Put several items from one message in ONE call. Link each to project(s) with shares when it belongs to a deal / shipment / device / cost center.',
      inputSchema: z.object({
        entries: z.array(z.object({
          kind: z.enum(['expense', 'income']),
          amount: z.number(),
          entry_date: dateStr.optional(),
          category_id: z.number().int().optional().describe('From the categories list'),
          new_category: z.string().optional().describe('English name, only if no category fits'),
          new_category_ar: z.string().optional(),
          account_id: z.number().int().optional().describe('Cash box / bank etc. only if said or obvious'),
          new_account: z.string().optional(),
          party_name: z.string().optional().describe('Who was paid / who paid, if not a known client/supplier/employee'),
          client_id: z.number().int().optional(),
          supplier_id: z.number().int().optional(),
          employee_id: z.number().int().optional(),
          description: z.string().optional(),
          notes: z.string().optional(),
          links: z.array(z.object({
            project_id: z.number().int().optional(),
            new_project: z.string().optional().describe('Create a project with this name'),
            new_project_type: z.string().optional().describe('Type key for the new project, e.g. shipment, deal, device'),
            share_pct: z.number().optional().describe('Percent of this amount for the project (default 100)'),
          })).optional(),
        })).min(1),
        summary: summaryField,
        confident: confidentField,
      }),
      execute: async ({ entries, summary, confident }) => write('record_entries', summary, { entries: entries.map(clean) }, { confident }),
    }),

    receive_client_payment: tool({
      description: 'A client paid us (on account). It is spread over their oldest open invoices automatically.',
      inputSchema: z.object({
        client_id: z.number().int(), amount: z.number(), payment_date: dateStr.optional(),
        payment_method: z.enum(['cash', 'bank_transfer', 'cheque', 'card', 'wallet', 'other']).optional(),
        reference_number: z.string().optional(), summary: summaryField, confident: confidentField,
      }),
      execute: async ({ summary, confident, ...p }) => write('client_payment', summary, clean(p), { confident }),
    }),

    pay_supplier: tool({
      description: 'We paid a supplier. Settles their oldest open purchases first; any extra is kept as an advance.',
      inputSchema: z.object({
        supplier_id: z.number().int(), amount: z.number(), payment_date: dateStr.optional(),
        payment_method: z.enum(['cash', 'bank_transfer', 'cheque', 'card', 'wallet', 'other']).optional(),
        reference_number: z.string().optional(), summary: summaryField, confident: confidentField,
      }),
      execute: async ({ summary, confident, ...p }) => write('supplier_payment', summary, clean(p), { confident }),
    }),

    record_sale: tool({
      description: 'A sale to a client (becomes a client transaction / invoice draft). VAT 14% is added by default; withholding tax (0, 1 or 3%) is deducted when said.',
      inputSchema: z.object({
        client_id: z.number().int(),
        lines: z.array(z.object({
          product_id: z.number().int().optional(),
          product_name: z.string().optional().describe('Only for a product that does not exist yet'),
          quantity: z.number(),
          unit_price: z.number().describe('Price per unit before VAT'),
        })).min(1),
        vat_rate: z.number().optional(), wht_rate: z.number().optional(),
        paid_now: z.number().optional(), payment_method: z.string().optional(),
        transaction_date: dateStr.optional(), invoice_number: z.string().optional(),
        status: z.enum(['not_started', 'in_progress', 'invoice', 'paused', 'paid', 'done']).optional(),
        summary: summaryField, confident: confidentField,
      }),
      execute: async ({ summary, confident, lines, ...p }) => write('record_sale', summary, { ...clean(p), lines: lines.map(clean) }, { confident }),
    }),

    record_purchase: tool({
      description: 'A purchase from a supplier (one product line).',
      inputSchema: z.object({
        supplier_id: z.number().int(),
        product_id: z.number().int().optional(), product_name: z.string().optional(),
        quantity: z.number().int(), unit_price: z.number(),
        paid_now: z.number().optional(), payment_method: z.string().optional(),
        transaction_date: dateStr.optional(), invoice_number: z.string().optional(),
        status: z.enum(['not_started', 'in_progress', 'invoice', 'paused', 'paid', 'done']).optional(),
        summary: summaryField, confident: confidentField,
      }),
      execute: async ({ summary, confident, ...p }) => write('record_purchase', summary, clean(p), { confident }),
    }),

    // ------------------------------------------------------------------ projects
    create_project: tool({
      description: 'Create a project of any type (deal, shipment, device, bom, cost_center, general or a custom type). Use attributes_json for the type\'s custom fields.',
      inputSchema: z.object({
        name: z.string(), type_key: z.string().describe('Key of an existing project type'),
        status: z.enum(['active', 'on_hold', 'done', 'cancelled']).optional(),
        client_id: z.number().int().optional(), supplier_id: z.number().int().optional(), product_id: z.number().int().optional(),
        parent_id: z.number().int().optional(), budget: z.number().optional(),
        start_date: dateStr.optional(), end_date: dateStr.optional(),
        aliases: z.array(z.string()).optional().describe('Other names the owner may use for it, e.g. Arabic name'),
        attributes_json: z.string().optional().describe('JSON object of custom field values, e.g. {"container_no":"MSCU123"}'),
        notes: z.string().optional(), summary: summaryField,
      }),
      execute: async ({ summary, type_key, attributes_json, ...p }) => {
        const types = await ask(`select id from project_types where key = ${sqlText(type_key)} and deleted_at is null`)
        if (!types.length) return { status: 'error', error: `No project type "${type_key}". Create it with create_project_type first.` }
        const values = clean({ ...p, type_id: types[0].id, attributes: parseJsonObject(attributes_json, 'attributes_json') })
        return write('create_record', summary, { table: 'projects', values })
      },
    }),

    create_project_type: tool({
      description: 'Define a new kind of project with its own custom fields (e.g. "Tender", "Maintenance contract").',
      inputSchema: z.object({
        key: z.string().describe('short_snake_case'), name_en: z.string(), name_ar: z.string(),
        icon: z.enum(['folder', 'handshake', 'ship', 'cpu', 'layers', 'wallet', 'truck', 'building', 'wrench', 'stethoscope', 'file']).optional(),
        color: z.enum(['blue', 'teal', 'violet', 'amber', 'slate', 'gray', 'rose', 'green', 'orange']).optional(),
        fields_json: z.string().optional().describe('JSON array: [{"key":"tender_no","label_en":"Tender no.","label_ar":"رقم المناقصة","type":"text|number|date|select","options":[]}]'),
        summary: summaryField,
      }),
      execute: async ({ summary, fields_json, ...p }) => {
        let fields = []
        if (fields_json) {
          try { fields = JSON.parse(fields_json) } catch { return { status: 'error', error: 'fields_json must be a JSON array' } }
          if (!Array.isArray(fields)) return { status: 'error', error: 'fields_json must be a JSON array' }
        }
        return write('create_record', summary, { table: 'project_types', values: clean({ ...p, key: p.key.toLowerCase().replace(/[^a-z0-9_]+/g, '_'), fields }) })
      },
    }),

    link_to_project: tool({
      description: 'Attach existing records (sales, purchases, payments, ledger entries, liabilities, compliance items, products...) to projects, with an optional share %.',
      inputSchema: z.object({
        links: z.array(z.object({
          record_type: z.enum(RECORD_TYPES), record_id: z.number().int(),
          project_id: z.number().int().optional(), new_project: z.string().optional(), new_project_type: z.string().optional(),
          share_pct: z.number().optional(),
        })).min(1),
        summary: summaryField,
      }),
      execute: async ({ links, summary }) => write('link_records', summary, { links: links.map(clean) }),
    }),

    // ------------------------------------------------------------------ any record
    create_record: tool({
      description: `Create a record directly in: ${CREATABLE.join(', ')}. (Use the dedicated tools for money, sales, purchases, payments and projects.)`,
      inputSchema: z.object({
        table: z.enum(CREATABLE),
        values_json: z.string().describe('JSON object of column values, e.g. {"client_name":"مستشفى السلام","contact_info":"0100..."}'),
        summary: summaryField, confident: confidentField,
      }),
      execute: async ({ table, values_json, summary, confident }) =>
        write('create_record', summary, { table, values: parseJsonObject(values_json, 'values_json') }, { confident }),
    }),

    update_record: tool({
      description: `Change fields of one record in: ${EDITABLE.join(', ')}. Always waits for the owner's Confirm. Find the id first.`,
      inputSchema: z.object({
        table: z.enum(EDITABLE), id: z.string().describe('Record id'),
        values_json: z.string().describe('JSON object with only the columns to change'),
        summary: summaryField,
      }),
      execute: async ({ table, id, values_json, summary }) =>
        write('update_record', summary, { table, id: String(id), values: parseJsonObject(values_json, 'values_json') }),
    }),

    delete_record: tool({
      description: 'Delete one record (ledger entries / projects / categories are archived, not destroyed). Always waits for Confirm.',
      inputSchema: z.object({ table: z.enum(EDITABLE), id: z.string().describe('Record id'), summary: summaryField }),
      execute: async ({ table, id, summary }) => write('delete_record', summary, { table, id: String(id) }),
    }),

    undo_action: tool({
      description: 'Undo something the agent saved (by action id from recent_actions or an earlier result). Only when the owner asks to undo / cancel / reverse it.',
      inputSchema: z.object({ action_id: z.string() }),
      execute: async ({ action_id }) => {
        try {
          return { status: 'undone', action_id, ...(await rpc('agent_undo', { p_action: action_id })) }
        } catch (e) {
          return { status: 'error', error: e.message }
        }
      },
    }),

    // ------------------------------------------------------------------ memory & settings
    remember: tool({
      description: 'Save something to remember across conversations: an alias ("أبو أحمد" = supplier X), a preference, a fact, or a correction the owner made.',
      inputSchema: z.object({ kind: z.enum(['alias', 'preference', 'fact', 'correction']), subject: z.string(), content: z.string() }),
      execute: async ({ kind, subject, content }) => ({ saved: true, ...(await rpc('agent_remember', { p_kind: kind, p_subject: subject, p_content: content })) }),
    }),

    forget: tool({
      description: 'Remove a remembered item by its id (from the memory list in your instructions).',
      inputSchema: z.object({ memory_id: z.number().int() }),
      execute: async ({ memory_id }) => {
        await rpc('agent_forget', { p_id: memory_id })
        return { forgotten: memory_id }
      },
    }),

    ai_costs: tool({
      description: 'How much Gemini (the AI behind you: chat, voice, read-aloud, web search, document scans) has cost, in USD, for a date range (default: this month). Estimates from published prices; the real bill is in Google AI Studio. Use for "صرفنا كام على جيميناي / الذكاء الاصطناعي".',
      inputSchema: z.object({
        from: z.string().optional().describe('YYYY-MM-DD, default first day of this month'),
        to: z.string().optional().describe('YYYY-MM-DD, default today'),
      }),
      execute: async ({ from, to }) => ({ costs: await rpc('ai_usage_summary', { p_from: from || null, p_to: to || null }), currency: 'USD', note: 'Estimated from token counts and published Gemini prices' }),
    }),

    agent_settings: tool({
      description: 'Change the agent\'s own settings: auto-save limit in EGP (0 = always ask) or spoken replies on/off.',
      inputSchema: z.object({ auto_save_limit: z.number().optional(), voice_replies: z.boolean().optional() }),
      execute: async ({ auto_save_limit, voice_replies }) => ({
        settings: await rpc('agent_set_settings', { p_auto_save_limit: auto_save_limit ?? null, p_voice_replies: voice_replies ?? null }),
      }),
    }),

    // ------------------------------------------------------------------ screen
    open_page: tool({
      description: 'Open a screen of the app for the owner (the app navigates there).',
      inputSchema: z.object({ page: z.enum(Object.keys(PAGES)), id: z.number().int().optional().describe('For project / bom / compliance pages') }),
      execute: async ({ page, id }) => {
        let path = PAGES[page]
        if (path.includes(':id')) {
          if (id === undefined) return { error: 'This page needs an id' }
          path = path.replace(':id', String(id))
        }
        return { navigate: path }
      },
    }),

    show_table: tool({
      description: 'Show a table in the chat from a read-only SELECT (and optionally download it as CSV or PDF). Use for lists, statements and exports.',
      inputSchema: z.object({
        title: z.string(), sql: z.string(),
        export_format: z.enum(['none', 'csv', 'pdf']).optional().describe('Download a file too'),
      }),
      execute: async ({ title, sql, export_format }) => {
        try {
          const rows = await ask(sql)
          return { title, columns: rows.length ? Object.keys(rows[0]) : [], rows, export_format: export_format || 'none' }
        } catch (e) {
          return { error: e.message }
        }
      },
    }),

    show_chart: tool({
      description: 'Show a chart in the chat from a read-only SELECT that returns one label column and one or more number columns.',
      inputSchema: z.object({
        title: z.string(), sql: z.string(), chart: z.enum(['bar', 'line', 'pie']),
        x: z.string().describe('Label column name'), y: z.array(z.string()).min(1).describe('Number column names'),
      }),
      execute: async ({ title, sql, chart, x, y }) => {
        try {
          const rows = await ask(sql)
          return { title, chart, x, y, rows: rows.slice(0, 60) }
        } catch (e) {
          return { error: e.message }
        }
      },
    }),

    // ------------------------------------------------------------------ compliance documents
    file_legal_document: tool({
      description: 'File an attached document (licence, certificate, registration, contract, permit...) into the Compliance inbox and scan it with the document reader. Use the attachment path from the owner\'s message.',
      inputSchema: z.object({
        attachment_path: z.string(), file_name: z.string(), mime_type: z.string(),
        size_bytes: z.number().int().optional(), title_hint: z.string().optional(),
      }),
      execute: async ({ attachment_path, file_name, mime_type, size_bytes, title_hint }) => {
        const documentId = await rpc('agent_file_compliance_document', {
          p_path: attachment_path, p_file_name: file_name, p_mime: mime_type, p_size: size_bytes ?? null, p_title: title_hint ?? null,
        })
        const scan = await scanDocument(documentId)
        return { document_id: documentId, ...scan, review_page: `/compliance/review-orphan/${documentId}` }
      },
    }),

    scan_compliance_document: tool({
      description: 'Run the document reader on a compliance document already in the system (by document id) and report what it found.',
      inputSchema: z.object({ document_id: z.number().int() }),
      execute: async ({ document_id }) => scanDocument(document_id),
    }),

    // ------------------------------------------------------------------ outside world
    web_search: tool({
      description: 'Search the web for current information (prices, regulations, exchange rates, news, company info). Not for Promed\'s own data.',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        if (!ctx.getGoogle) return { error: 'Web search is not available here' }
        const google = ctx.getGoogle()
        const { text, sources, usage, response } = await generateText({
          model: google(MODELS.search),
          tools: { google_search: google.tools.googleSearch({}) },
          prompt: `Search the web and answer concisely with facts and dates: ${query}`,
          maxRetries: 1,
        })
        ctx.usage?.report({ feature: 'web_search', model: response?.modelId || MODELS.search, usage })
        return { answer: text, sources: (sources || []).slice(0, 6).map((s) => ({ title: s.title, url: s.url })) }
      },
    }),
  }

  async function scanDocument(documentId) {
    if (!ctx.extractDocument) return { scanned: false, note: 'The document reader is not available here; it will be scanned when Compliance is opened.' }
    const advance = (patch) => rpc('advance_document_processing', { p_document_id: documentId, ...clean(patch) })
    try {
      await advance({ p_next_status: 'ocr_processing' })
      const p = await ctx.extractDocument(documentId)
      await advance({
        p_next_status: p.nextStatus || 'waiting_for_review',
        p_extracted_text: p.extractedText ?? null,
        p_extracted_metadata: p.extractedMetadata ?? null,
        p_ai_summary: p.aiSummary ?? null,
        p_document_type: p.documentType ?? null,
        p_language: p.language ?? null,
        p_confidence: p.confidenceScore ?? null,
      })
      return {
        scanned: true, status: p.nextStatus || 'waiting_for_review',
        document_type: p.documentType, summary: p.aiSummary, confidence: p.confidenceScore, metadata: p.extractedMetadata,
      }
    } catch (e) {
      await advance({ p_next_status: 'failed', p_error: e.message }).catch(() => {})
      return { scanned: false, error: e.message, note: 'Saved in the Compliance inbox; it can be reviewed by hand.' }
    }
  }

  return tools
}
