// DEV ONLY (loaded from main.jsx when import.meta.env.DEV and the path starts with /__preview).
// Renders the agent panel and the new pages with sample data so the UI can be checked
// without signing in. Nothing here talks to the real database.
import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { LanguageProvider } from '../context/LanguageContext'
import { AuthProvider } from '../context/AuthContext'
import { ToastProvider, useToast } from '../context/ToastContext'
import { KeyboardShortcutsProvider } from '../context/KeyboardShortcutsContext'
import Sidebar from '../components/Sidebar'
import BottomNav from '../components/BottomNav'
import ToastContainer from '../components/ToastContainer'
import AgentDock from '../components/agent/AgentDock'
import MoneyPage from '../components/money/MoneyPage'
import ProjectsPage from '../components/projects/ProjectsPage'
import ProjectDetail from '../components/projects/ProjectDetail'
import AgentActivity from '../components/agent/AgentActivity'

const UID = '00000000-0000-4000-8000-000000000001'
const d = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10) }
const ts = (mins) => new Date(Date.now() - mins * 60000).toISOString()

const TYPES = [
  { id: 1, key: 'deal', name_en: 'Deal / tender', name_ar: 'صفقة / مناقصة', icon: 'handshake', color: 'blue', fields: [{ key: 'tender_no', label_en: 'Tender no.', label_ar: 'رقم المناقصة', type: 'text' }] },
  { id: 2, key: 'shipment', name_en: 'Shipment', name_ar: 'شحنة', icon: 'ship', color: 'teal', fields: [{ key: 'container_no', label_en: 'Container no.', label_ar: 'رقم الكونتينر', type: 'text' }] },
  { id: 3, key: 'device', name_en: 'Device / product', name_ar: 'جهاز / منتج', icon: 'cpu', color: 'violet', fields: [] },
  { id: 5, key: 'cost_center', name_en: 'Cost center', name_ar: 'بند مصروفات', icon: 'wallet', color: 'slate', fields: [] },
]
const T = Object.fromEntries(TYPES.map((t) => [t.id, t]))
const proj = (id, name, type, status, income, expense, budget, records, last) => ({
  project_id: id, name, status, type_id: type, type_key: T[type].key, type_en: T[type].name_en, type_ar: T[type].name_ar, icon: T[type].icon, color: T[type].color,
  parent_id: null, budget, start_date: d(60), end_date: null, client_id: null, supplier_id: null, product_id: null,
  income, expense, net: income - expense, records, last_activity: d(last), created_at: ts(90000),
})
const PROJECTS = [
  proj(1, 'Tender — Cairo University Hospital', 1, 'active', 480000, 312500, 350000, 14, 1),
  proj(2, 'Shipment #24 — Germany', 2, 'active', 0, 186400, 200000, 9, 2),
  proj(3, 'Company car', 5, 'active', 0, 23850, null, 31, 0),
  proj(4, 'Office', 5, 'active', 0, 41200, 60000, 22, 3),
  proj(5, 'Ultrasound unit SN-4471', 3, 'on_hold', 95000, 61000, null, 6, 12),
  proj(6, 'Tender — Ain Shams', 1, 'done', 260000, 198000, 210000, 18, 40),
]
const CATS = [
  { id: 1, name_en: 'Fuel', name_ar: 'بنزين', kind: 'expense' }, { id: 2, name_en: 'Rent', name_ar: 'إيجار', kind: 'expense' },
  { id: 3, name_en: 'Salaries', name_ar: 'مرتبات', kind: 'expense' }, { id: 4, name_en: 'Customs', name_ar: 'جمارك', kind: 'expense' },
  { id: 5, name_en: 'Shipping', name_ar: 'شحن', kind: 'expense' }, { id: 6, name_en: 'Service income', name_ar: 'إيراد صيانة', kind: 'income' },
  { id: 7, name_en: 'Transport', name_ar: 'مواصلات', kind: 'expense' },
]
const ACCOUNTS = [{ id: 1, name: 'Cash box', kind: 'cash' }, { id: 2, name: 'Bank', kind: 'bank' }]
const led = (id, kind, amount, cat, days, desc, party, projects = [], source = 'manual', voice = null, account = 1) => {
  const c = CATS.find((x) => x.id === cat)
  return {
    id, kind, amount, currency: 'EGP', entry_date: d(days), description: desc, notes: null, party_name: party, source, voice_text: voice,
    category_id: cat, category_en: c.name_en, category_ar: c.name_ar, account_id: account, account_name: ACCOUNTS[account - 1].name,
    client_id: null, client_name: null, supplier_id: null, supplier_name: null, employee_id: null, employee_name: null, projects, created_at: ts(days * 1440),
  }
}
const LEDGER = [
  led(41, 'expense', 350, 1, 0, 'Fuel', null, [{ project_id: 3, name: 'Company car', share_pct: 100 }], 'agent', 'دفعت 350 بنزين للعربية'),
  led(40, 'expense', 12500, 4, 1, 'Customs clearance', 'Alexandria port', [{ project_id: 2, name: 'Shipment #24 — Germany', share_pct: 100 }], 'agent', 'دفعت تخليص جمركي 12500 للشحنة', 2),
  led(39, 'income', 4800, 6, 2, 'Maintenance visit', 'Dar El Fouad', [], 'manual'),
  led(38, 'expense', 9000, 2, 3, 'Office rent', 'Landlord', [{ project_id: 4, name: 'Office', share_pct: 100 }], 'manual', null, 2),
  led(37, 'expense', 1800, 5, 4, 'DHL — samples', 'DHL', [{ project_id: 1, name: 'Tender — Cairo University Hospital', share_pct: 60 }, { project_id: 5, name: 'Ultrasound unit SN-4471', share_pct: 40 }], 'agent', 'شحن عينات 1800 ستين في المية للمناقصة والباقي للجهاز'),
  led(36, 'expense', 120, 7, 4, 'Taxi', null, [], 'agent', 'تاكسي 120'),
  led(35, 'expense', 24000, 3, 6, 'Salaries — technicians', null, [], 'manual', null, 2),
]
const MESSAGES = [
  { message_id: 'u1', role: 'user', parts: [{ type: 'text', text: 'دفعت 350 بنزين للعربية و 120 تاكسي' }] },
  {
    message_id: 'a1', role: 'assistant', parts: [
      { type: 'tool-find', toolCallId: 'c0', state: 'output-available', input: {}, output: [] },
      {
        type: 'tool-record_money', toolCallId: 'c1', state: 'output-available', input: {},
        output: {
          status: 'saved', action_id: 'act-1', kind: 'record_entries', summary: 'Fuel 350 + taxi 120', why: 'new entry under EGP 5,000',
          details: { type: 'entries', total: 470, lines: [
            { kind: 'expense', amount: 350, date: d(0), category: { en: 'Fuel', ar: 'بنزين' }, projects: [{ name: 'Company car', share: 100 }], account: 'Cash box' },
            { kind: 'expense', amount: 120, date: d(0), category: { en: 'Transport', ar: 'مواصلات' }, projects: [], account: 'Cash box' },
          ] },
        },
      },
      { type: 'text', text: 'اتسجّلوا ✅ **470 جنيه**: البنزين على **عربية الشركة** والتاكسي مواصلات.' },
    ],
  },
  { message_id: 'u2', role: 'user', parts: [{ type: 'text', text: 'دار الفؤاد دفعوا 18 ألف تحويل بنكي' }] },
  {
    message_id: 'a2', role: 'assistant', parts: [
      {
        type: 'tool-receive_client_payment', toolCallId: 'c2', state: 'output-available', input: {},
        output: {
          status: 'pending', action_id: 'act-2', kind: 'client_payment', summary: 'Dar El Fouad paid EGP 18,000 by bank transfer',
          why: 'EGP 18,000 is at or above your auto-save limit of EGP 5,000', why_code: 'limit', why_amount: 18000, why_limit: 5000,
          details: { type: 'payment', direction: 'in', party: 'Dar El Fouad Hospital', amount: 18000, method: 'bank_transfer', covers: [{ invoice: 'INV-0142', amount: 11200 }, { invoice: 'INV-0151', amount: 6800 }], left_over: 0 },
        },
      },
      { type: 'text', text: 'جهزتها — المبلغ أكبر من حد الحفظ التلقائي، فدوس **تأكيد** لو تمام. هتغطي فاتورة INV-0142 كلها وجزء من INV-0151.' },
    ],
  },
  { message_id: 'u3', role: 'user', parts: [{ type: 'text', text: 'وريني مصاريف الشهر ده متقسمة على التصنيفات وطلعهالي PDF' }] },
  {
    message_id: 'a3', role: 'assistant', parts: [
      { type: 'tool-money_report', toolCallId: 'c3', state: 'output-available', input: {}, output: {} },
      {
        type: 'tool-show_chart', toolCallId: 'c4', state: 'output-available', input: {},
        output: { title: 'Expenses this month', chart: 'bar', x: 'category', y: ['total'], rows: [
          { category: 'Salaries', total: 24000 }, { category: 'Customs', total: 12500 }, { category: 'Rent', total: 9000 }, { category: 'Shipping', total: 1800 }, { category: 'Fuel', total: 350 }, { category: 'Transport', total: 120 },
        ] },
      },
      {
        type: 'tool-show_table', toolCallId: 'c5', state: 'output-available', input: {},
        output: { title: 'Expenses by category', export_format: 'pdf', columns: ['category', 'entries', 'total'], rows: [
          { category: 'Salaries', entries: 1, total: 24000 }, { category: 'Customs', entries: 1, total: 12500 }, { category: 'Rent', entries: 1, total: 9000 },
          { category: 'Shipping', entries: 1, total: 1800 }, { category: 'Fuel', entries: 1, total: 350 }, { category: 'Transport', entries: 1, total: 120 },
        ] },
      },
      { type: 'text', text: 'إجمالي المصاريف الشهر ده **47,770 جنيه**. أكبر بند المرتبات (50%) وبعدها الجمارك.\n\n- المرتبات: 24,000\n- الجمارك: 12,500\n- الإيجار: 9,000' },
    ],
  },
  { message_id: 'u4', role: 'user', parts: [{ type: 'text', text: 'عدّل سعر الجهاز Mindray DC-70 لـ 1,250,000' }] },
  {
    message_id: 'a4', role: 'assistant', parts: [
      {
        type: 'tool-update_record', toolCallId: 'c6', state: 'output-available', input: {},
        output: {
          status: 'pending', action_id: 'act-3', kind: 'update', summary: 'Change Mindray DC-70 price', why: 'edits and deletions always need your confirmation', why_code: 'edit',
          details: { type: 'update', table: 'products', id: 12, changes: [{ field: 'unit_price', from: 1100000, to: 1250000 }] },
        },
      },
    ],
  },
]
const ACTIONS = [
  { id: 'act-3', kind: 'update', summary: 'Change Mindray DC-70 price', status: 'pending', voice_text: null, created_at: ts(2), applied_at: null, undone_at: null, error: null },
  { id: 'act-2', kind: 'client_payment', summary: 'Dar El Fouad paid EGP 18,000 by bank transfer', status: 'pending', voice_text: 'دار الفؤاد دفعوا 18 ألف تحويل بنكي', created_at: ts(4), applied_at: null, undone_at: null, error: null },
  { id: 'act-1', kind: 'record_entries', summary: 'Fuel 350 + taxi 120', status: 'applied', voice_text: 'دفعت 350 بنزين للعربية و 120 تاكسي', created_at: ts(6), applied_at: ts(6), undone_at: null, error: null },
  { id: 'act-0', kind: 'record_entries', summary: 'Customs clearance 12,500 — Shipment #24', status: 'applied', voice_text: 'دفعت تخليص جمركي 12500 للشحنة', created_at: ts(1500), applied_at: ts(1490), undone_at: null, error: null },
  { id: 'act-z', kind: 'record_entries', summary: 'Taxi 200', status: 'undone', voice_text: 'تاكسي ميتين', created_at: ts(3000), applied_at: ts(3000), undone_at: ts(2990), error: null },
]
const CHANGES = [{ id: 1, table_name: 'ledger_entries', op: 'insert', pk_val: '41', before: null, after: { amount: 350 } }, { id: 2, table_name: 'record_links', op: 'insert', pk_val: '88', before: null, after: {} }]

const TABLES = {
  project_types: TYPES, v_project_totals: PROJECTS, categories: CATS, money_accounts: ACCOUNTS, v_ledger: LEDGER,
  projects: PROJECTS.map((p) => ({ id: p.project_id, name: p.name, type_id: p.type_id, status: p.status, budget: p.budget, aliases: [], attributes: {}, notes: null })),
  clients: [{ client_id: 1, client_name: 'Dar El Fouad Hospital' }], agent_messages: MESSAGES, agent_actions: ACTIONS, agent_changes: CHANGES,
  agent_settings: [{ voice_replies: false, auto_save_limit: 5000 }], app_members: [{ role: 'owner' }],
  agent_conversations: [{ id: 'c-1', title: 'بنزين وتاكسي وتحصيل دار الفؤاد', updated_at: ts(2) }, { id: 'c-2', title: 'تقرير مصاريف أكتوبر', updated_at: ts(3000) }],
}

function builder(table) {
  let single = false
  const q = {}
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'gte', 'lte', 'insert', 'update', 'filter', 'neq', 'ilike']) q[m] = () => q
  q.maybeSingle = () => { single = true; return q }
  q.single = () => { single = true; return q }
  q.then = (res, rej) => {
    const rows = TABLES[table] || []
    return Promise.resolve({ data: single ? (table === 'projects' ? rows[0] : rows[0] || { id: 1 }) : rows, error: null }).then(res, rej)
  }
  return q
}

function overview(id) {
  const p = PROJECTS.find((x) => x.project_id === id) || PROJECTS[0]
  const records = LEDGER.filter((l) => l.projects.some((x) => x.project_id === p.project_id))
  return {
    project: p, attributes: { tender_no: 'CU-2026-118' }, aliases: ['مناقصة القصر العيني'], notes: 'Delivery and installation of 4 ultrasound units + training.',
    type_fields: T[p.type_id].fields, parent: null, children: [], client: { id: 1, name: 'Cairo University Hospitals' }, supplier: null, product: null,
    by_category: [
      { category: 'Sales', direction: 'income', total: 480000, n: 2 }, { category: 'Purchases', direction: 'expense', total: 248000, n: 1 },
      { category: 'Customs', direction: 'expense', total: 38500, n: 2 }, { category: 'Shipping', direction: 'expense', total: 14080, n: 4 },
      { category: 'Transport', direction: 'expense', total: 6920, n: 6 }, { category: 'Commission', direction: 'expense', total: 5000, n: 1 },
    ],
    records: [
      { record_type: 'client_transaction', record_id: 211, date: d(5), direction: 'income', amount: 240000, label: 'INV-0150', category: 'Sales' },
      ...records.map((l) => ({ record_type: 'ledger_entry', record_id: l.id, date: l.entry_date, direction: l.kind, amount: l.amount * (l.projects.find((x) => x.project_id === p.project_id).share_pct / 100), label: l.description, category: l.category_en })),
      { record_type: 'supplier_transaction', record_id: 98, date: d(20), direction: 'expense', amount: 248000, label: 'PO-0098 Mindray', category: 'Purchases' },
    ],
  }
}

function patchSupabase() {
  if (supabase.__preview) return
  supabase.__preview = true
  const session = { access_token: 'preview', user: { id: UID, email: 'owner@example.test', user_metadata: {} } }
  supabase.from = builder
  supabase.rpc = async (fn, args) => {
    if (fn === 'project_overview') return { data: overview(args.p_project), error: null }
    return { data: null, error: null }
  }
  supabase.auth.getSession = async () => ({ data: { session } })
  supabase.auth.onAuthStateChange = (cb) => { setTimeout(() => cb('INITIAL_SESSION', session), 0); return { data: { subscription: { unsubscribe() {} } } } }
}

function OpenAgent() {
  const loc = useLocation()
  useEffect(() => {
    if (new URLSearchParams(loc.search).get('agent') === '1') setTimeout(() => window.dispatchEvent(new CustomEvent('promed:agent-open')), 300)
  }, [loc.search])
  return null
}

function Toasts() {
  const { toasts, removeToast } = useToast()
  return <ToastContainer toasts={toasts} removeToast={removeToast} />
}

function Shell() {
  return (
    <div className="app-wallpaper h-full flex flex-col overflow-hidden">
      <div className="flex h-full min-h-0">
        <Sidebar mobileOpen={false} onClose={() => {}} />
        <div className="flex-1 flex flex-col min-w-0 ms-0 md:ms-60">
          <main className="app-main flex-1 min-h-0 flex flex-col overflow-hidden max-w-7xl w-full mx-auto py-2 sm:py-3 px-3 sm:px-4 lg:px-6">
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col main-scroll-mobile">
              <Routes>
                <Route path="/money" element={<MoneyPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/:id" element={<ProjectDetail />} />
                <Route path="/agent" element={<AgentActivity />} />
                <Route path="*" element={<div className="p-6 space-x-3"><Link to="/money">money</Link><Link to="/projects">projects</Link><Link to="/agent">agent</Link></div>} />
              </Routes>
            </div>
          </main>
        </div>
        <BottomNav menuOpen={false} onMenuClick={() => {}} />
        <AgentDock />
        <OpenAgent />
        <Toasts />
      </div>
    </div>
  )
}

export default function DevPreview() {
  patchSupabase()
  const lang = new URLSearchParams(window.location.search).get('lang')
  if (lang) localStorage.setItem('language', lang)
  try { localStorage.setItem('promed.agent.conversation', 'c-1') } catch { /* ignore */ }
  return (
    <BrowserRouter basename="/__preview">
      <LanguageProvider>
        <AuthProvider>
          <ToastProvider>
            <KeyboardShortcutsProvider>
              <Shell />
            </KeyboardShortcutsProvider>
          </ToastProvider>
        </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  )
}

