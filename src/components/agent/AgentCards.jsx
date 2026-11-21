import { useContext, useEffect, useMemo, useRef, useState, createContext } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import {
  Wallet, ArrowDownLeft, ArrowUpRight, ShoppingCart, Truck, FolderPlus, Pencil, Trash2, Link2, FilePlus, Check, X,
  Undo2, Loader2, AlertTriangle, Download, FileText, Shield, Globe, Search, BarChart3, Table2, CircleCheck, Clock,
  ExternalLink, Brain, Settings2, Sparkles,
} from 'lucide-react'
import { agentAction } from '../../lib/agentApi'
import { downloadCsv } from '../../utils/exportCsv'
import { exportTablePdf, formatCell, prettyHeader } from '../../utils/exportTablePdf'

/** action_id -> live status (applied / pending / undone / cancelled / failed). */
export const ActionStatusContext = createContext({ statuses: {}, setStatus: () => {} })

export const money = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })

const KIND_ICON = {
  record_entries: Wallet, client_payment: ArrowDownLeft, supplier_payment: ArrowUpRight, record_sale: ShoppingCart,
  record_purchase: Truck, create_record: FilePlus, update_record: Pencil, delete_record: Trash2, link_records: Link2, batch: FolderPlus,
}

const STATUS_STYLE = {
  saved: { tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: CircleCheck },
  applied: { tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: CircleCheck },
  pending: { tone: 'bg-amber-50 text-amber-800 ring-amber-200', icon: Clock },
  undone: { tone: 'bg-slate-100 text-slate-600 ring-slate-200', icon: Undo2 },
  cancelled: { tone: 'bg-slate-100 text-slate-600 ring-slate-200', icon: X },
  failed: { tone: 'bg-rose-50 text-rose-700 ring-rose-200', icon: AlertTriangle },
  error: { tone: 'bg-rose-50 text-rose-700 ring-rose-200', icon: AlertTriangle },
}

function Chip({ children, className = '' }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${className}`}>{children}</span>
}

function Row({ label, value, strong }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
      <span className="text-slate-500">{label}</span>
      <span className={`tabular-nums ${strong ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{value}</span>
    </div>
  )
}

function EntriesBody({ d, t, ar }) {
  return (
    <div className="space-y-2">
      {d.lines.map((l, i) => (
        <div key={i} className="rounded-xl bg-white/70 ring-1 ring-slate-200/70 px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-slate-800 truncate">
                {l.description || (l.category ? (ar ? l.category.ar || l.category.en : l.category.en) : t(`agent.kind_${l.kind}`))}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {l.category && <Chip className="bg-blue-50 text-blue-700 ring-blue-100">{ar ? l.category.ar || l.category.en : l.category.en}{l.category.isNew ? ` · ${t('agent.new')}` : ''}</Chip>}
                {l.projects?.map((p, j) => (
                  <Chip key={j} className="bg-violet-50 text-violet-700 ring-violet-100">{p.name}{p.isNew ? ` · ${t('agent.new')}` : ''}{p.share !== 100 ? ` · ${p.share}%` : ''}</Chip>
                ))}
                {l.party && <Chip className="bg-slate-50 text-slate-600 ring-slate-200">{l.party}</Chip>}
                {l.account && <Chip className="bg-teal-50 text-teal-700 ring-teal-100">{l.account}</Chip>}
              </div>
            </div>
            <div className={`shrink-0 text-[14px] font-semibold tabular-nums ${l.kind === 'income' ? 'text-emerald-700' : 'text-rose-700'}`}>
              {l.kind === 'income' ? '+' : '−'}{money(l.amount)}
            </div>
          </div>
          {l.date && <div className="mt-1 text-[11px] text-slate-400">{l.date}</div>}
        </div>
      ))}
      {d.lines.length > 1 && <Row label={t('agent.total')} value={`EGP ${money(d.total)}`} strong />}
    </div>
  )
}

function PaymentBody({ d, t }) {
  return (
    <div className="space-y-1.5">
      <Row label={d.direction === 'in' ? t('agent.from') : t('agent.to')} value={d.party || '—'} strong />
      <Row label={t('agent.amount')} value={`EGP ${money(d.amount)}`} strong />
      <Row label={t('agent.method')} value={t(`agent.method_${d.method}`)} />
      {d.covers?.length > 0 && (
        <div className="pt-1">
          <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">{t('agent.covers')}</div>
          {d.covers.map((c, i) => <Row key={i} label={c.invoice} value={money(c.amount)} />)}
        </div>
      )}
      {d.left_over > 0 && <Row label={d.direction === 'in' ? t('agent.credit') : t('agent.advance')} value={money(d.left_over)} />}
    </div>
  )
}

function SaleBody({ d, t }) {
  return (
    <div className="space-y-1.5">
      <Row label={d.type === 'sale' ? t('agent.client') : t('agent.supplier')} value={d.party || '—'} strong />
      {d.lines.map((l, i) => (
        <Row key={i} label={`${l.product}${l.isNew ? ` (${t('agent.new')})` : ''}`} value={`${l.quantity} × ${money(l.unit_price)}`} />
      ))}
      <div className="border-t border-slate-200/70 pt-1.5 space-y-1">
        {d.type === 'sale' && <Row label={t('agent.subtotal')} value={money(d.subtotal)} />}
        {d.vat > 0 && <Row label={t('agent.vat')} value={`+ ${money(d.vat)}`} />}
        {d.wht > 0 && <Row label={t('agent.wht')} value={`− ${money(d.wht)}`} />}
        <Row label={t('agent.total')} value={`EGP ${money(d.total)}`} strong />
        {d.paid > 0 && <Row label={t('agent.paid_now')} value={money(d.paid)} />}
        {d.paid > 0 && <Row label={t('agent.remaining')} value={money(d.remaining)} />}
      </div>
    </div>
  )
}

function KeyValues({ obj }) {
  const entries = Object.entries(obj || {}).filter(([k, v]) => v !== null && v !== '' && !['created_at', 'updated_at', 'user_id', 'created_by'].includes(k)).slice(0, 10)
  return (
    <div className="space-y-1">
      {entries.map(([k, v]) => <Row key={k} label={prettyHeader(k)} value={typeof v === 'object' ? JSON.stringify(v) : formatCell(v)} />)}
    </div>
  )
}

function DetailsBody({ output, t, ar }) {
  const d = output.details
  if (!d) return <p className="text-[13px] text-slate-700">{output.summary}</p>
  if (d.type === 'entries') return <EntriesBody d={d} t={t} ar={ar} />
  if (d.type === 'payment') return <PaymentBody d={d} t={t} />
  if (d.type === 'sale' || d.type === 'purchase') return <SaleBody d={d} t={t} />
  if (d.type === 'update') {
    return (
      <div className="space-y-1.5">
        <div className="text-[12px] text-slate-500">{t(`agent.table_${d.table}`)} #{d.id}</div>
        {d.changes.map((c, i) => (
          <div key={i} className="text-[12.5px]">
            <span className="text-slate-500">{prettyHeader(c.field)}: </span>
            <span className="line-through text-slate-400">{formatCell(c.from) || '—'}</span>
            <span className="mx-1 text-slate-400">→</span>
            <span className="font-medium text-slate-800">{formatCell(c.to)}</span>
          </div>
        ))}
      </div>
    )
  }
  if (d.type === 'delete') return <div><div className="text-[12px] text-slate-500 mb-1">{t(`agent.table_${d.table}`)} #{d.id}</div><KeyValues obj={d.record} /></div>
  if (d.type === 'create') return <div><div className="text-[12px] text-slate-500 mb-1">{t(`agent.table_${d.table}`)}</div><KeyValues obj={d.values} /></div>
  if (d.type === 'links') {
    return <div className="space-y-1">{d.links.map((l, i) => <Row key={i} label={`${t(`agent.record_${l.record_type}`)} #${l.record_id}`} value={`${l.project}${l.share !== 100 ? ` · ${l.share}%` : ''}`} />)}</div>
  }
  return <p className="text-[13px] text-slate-700">{output.summary}</p>
}

/** The card for anything the agent saved or wants to save. */
export function ActionCard({ output, t, language }) {
  const { statuses, setStatus } = useContext(ActionStatusContext)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const ar = language === 'ar'
  const id = output.action_id
  const live = statuses[id]
  const status = live || (output.status === 'saved' ? 'applied' : output.status)
  const Icon = KIND_ICON[output.kind] || Sparkles
  const style = STATUS_STYLE[status] || STATUS_STYLE.pending
  const StatusIcon = style.icon

  const run = async (op, opts) => {
    setBusy(op)
    setErr(null)
    try {
      const res = await agentAction(op, id, opts)
      setStatus(id, res.action?.status || (op === 'confirm' ? 'applied' : op === 'cancel' ? 'cancelled' : 'undone'))
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(null)
    }
  }

  if (output.status === 'error' && !id) {
    return (
      <div className="rounded-2xl bg-rose-50/80 ring-1 ring-rose-200 px-3 py-2 text-[12.5px] text-rose-800 flex gap-2">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" /> <span>{output.error}</span>
      </div>
    )
  }

  return (
    <div className={`rounded-2xl ring-1 overflow-hidden transition-opacity ${status === 'undone' || status === 'cancelled' ? 'opacity-70' : ''} bg-white/80 ring-white shadow-[0_10px_30px_-18px_rgba(30,64,140,0.45)]`}>
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center shrink-0"><Icon size={15} /></span>
        <div className="min-w-0 flex-1 text-[13px] font-semibold text-slate-800 line-clamp-2 leading-snug">{output.summary}</div>
        <Chip className={style.tone}><StatusIcon size={12} />{t(`agent.status_${status}`)}</Chip>
      </div>
      <div className="px-3 pb-3"><DetailsBody output={output} t={t} ar={ar} /></div>
      {status === 'pending' && output.why && (
        <div className="mx-3 mb-2 text-[11.5px] text-amber-800 bg-amber-50/80 rounded-lg px-2 py-1">{t('agent.why_waiting')}: {output.why_code ? t(`agent.why_${output.why_code}`, { amount: money(output.why_amount), limit: money(output.why_limit) }) : output.why}</div>
      )}
      {(err || status === 'failed') && (
        <div className="mx-3 mb-2 text-[12px] text-rose-700 bg-rose-50 rounded-lg px-2 py-1">
          {/Cannot undo/.test(err || '') ? t('agent.undo_conflict') : (err || output.error)}
          {/Cannot undo/.test(err || '') && (
            <button type="button" disabled={!!busy} onClick={() => run('undo', { force: true })} className="ms-2 underline font-medium">{t('agent.undo_force')}</button>
          )}
        </div>
      )}
      {(status === 'pending' || status === 'applied') && (
        <div className="flex gap-2 px-3 pb-3">
          {status === 'pending' ? (
            <>
              <button type="button" disabled={!!busy} onClick={() => run('confirm')}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-blue-600 to-blue-700 text-white text-[13px] font-semibold py-2 shadow-[0_8px_18px_-10px_rgba(29,78,216,0.9)] active:scale-[0.98] disabled:opacity-60">
                {busy === 'confirm' ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}{t('agent.confirm')}
              </button>
              <button type="button" disabled={!!busy} onClick={() => run('cancel')}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-white text-slate-700 ring-1 ring-slate-200 text-[13px] font-medium px-4 py-2 active:scale-[0.98] disabled:opacity-60">
                {busy === 'cancel' ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />}{t('agent.cancel')}
              </button>
            </>
          ) : (
            <button type="button" disabled={!!busy} onClick={() => run('undo')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/90 text-slate-700 ring-1 ring-slate-200 text-[12.5px] font-medium px-3 py-1.5 active:scale-[0.98] disabled:opacity-60">
              {busy === 'undo' ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}{t('agent.undo')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function TableCard({ output, t, fresh }) {
  const { title, columns = [], rows = [], export_format: fmt } = output
  const did = useRef(false)
  const [showAll, setShowAll] = useState(false)
  const doExport = async (kind) => {
    if (!rows.length) return
    if (kind === 'csv') downloadCsv(`${title.replace(/\s+/g, '_')}.csv`, rows)
    else await exportTablePdf(title, columns, rows)
  }
  useEffect(() => {
    if (fresh && !did.current && (fmt === 'csv' || fmt === 'pdf')) {
      did.current = true
      doExport(fmt)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh, fmt])
  if (output.error) return <div className="text-[12px] text-rose-700">{output.error}</div>
  const visible = showAll ? rows : rows.slice(0, 8)
  return (
    <div className="rounded-2xl bg-white/80 ring-1 ring-white shadow-[0_10px_30px_-18px_rgba(30,64,140,0.45)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <Table2 size={15} className="text-blue-700 shrink-0" />
        <div className="flex-1 min-w-0 text-[13px] font-semibold text-slate-800 truncate">{title}</div>
        <span className="text-[11px] text-slate-400">{rows.length}</span>
        <button type="button" onClick={() => doExport('csv')} className="text-[11px] font-medium text-blue-700 bg-blue-50 rounded-lg px-2 py-1 inline-flex items-center gap-1"><Download size={12} />CSV</button>
        <button type="button" onClick={() => doExport('pdf')} className="text-[11px] font-medium text-blue-700 bg-blue-50 rounded-lg px-2 py-1 inline-flex items-center gap-1"><FileText size={12} />PDF</button>
      </div>
      {rows.length === 0 ? (
        <div className="px-3 pb-3 text-[12.5px] text-slate-500">{t('agent.no_rows')}</div>
      ) : (
        <div className="overflow-x-auto max-h-72 border-t border-slate-200/70">
          <table className="min-w-full text-[12px]">
            <thead className="sticky top-0 bg-slate-50/95">
              <tr>{columns.map((c) => <th key={c} className="px-2.5 py-1.5 text-start font-semibold text-slate-600 whitespace-nowrap">{prettyHeader(c)}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((r, i) => (
                <tr key={i}>{columns.map((c) => <td key={c} className={`px-2.5 py-1.5 whitespace-nowrap ${typeof r[c] === 'number' ? 'tabular-nums text-end' : ''}`}>{formatCell(r[c])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 8 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="w-full text-[12px] text-blue-700 py-1.5 border-t border-slate-200/70">
          {showAll ? t('agent.show_less') : t('agent.show_all', { n: rows.length })}
        </button>
      )}
    </div>
  )
}

const CHART_COLORS = ['#2563eb', '#14b8a6', '#8b5cf6', '#f59e0b', '#ef4444', '#0ea5e9', '#22c55e', '#ec4899']

export function ChartCard({ output }) {
  const { title, chart, x, y = [], rows = [] } = output
  const data = useMemo(() => rows.map((r) => ({ ...r, ...Object.fromEntries(y.map((k) => [k, Number(r[k]) || 0])) })), [rows, y])
  if (output.error) return <div className="text-[12px] text-rose-700">{output.error}</div>
  return (
    <div className="rounded-2xl bg-white/80 ring-1 ring-white shadow-[0_10px_30px_-18px_rgba(30,64,140,0.45)] p-3">
      <div className="flex items-center gap-2 mb-2"><BarChart3 size={15} className="text-blue-700" /><div className="text-[13px] font-semibold text-slate-800">{title}</div></div>
      <div className="h-56" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          {chart === 'pie' ? (
            <PieChart>
              <Pie data={data} dataKey={y[0]} nameKey={x} innerRadius="45%" outerRadius="80%" paddingAngle={2}>
                {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => money(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          ) : chart === 'line' ? (
            <LineChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey={x} tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => money(v)} width={56} />
              <Tooltip formatter={(v) => money(v)} />
              {y.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {y.map((k, i) => <Line key={k} type="monotone" dataKey={k} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} />)}
            </LineChart>
          ) : (
            <BarChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey={x} tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => money(v)} width={56} />
              <Tooltip formatter={(v) => money(v)} />
              {y.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {y.map((k, i) => <Bar key={k} dataKey={k} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[6, 6, 0, 0]} />)}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function ComplianceCard({ output, t }) {
  return (
    <div className="rounded-2xl bg-white/80 ring-1 ring-white shadow-[0_10px_30px_-18px_rgba(30,64,140,0.45)] p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-rose-500 text-white flex items-center justify-center"><Shield size={15} /></span>
        <div className="flex-1 text-[13px] font-semibold text-slate-800">{output.document_type || t('agent.legal_document')}</div>
        {output.confidence != null && <Chip className="bg-slate-50 text-slate-600 ring-slate-200">{Math.round(Number(output.confidence) * (Number(output.confidence) <= 1 ? 100 : 1))}%</Chip>}
      </div>
      {output.summary && <p className="text-[12.5px] text-slate-700">{output.summary}</p>}
      {output.error && <p className="text-[12px] text-rose-700">{output.error}</p>}
      {output.review_page && (
        <Link to={output.review_page} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-blue-700">
          {t('agent.review_document')} <ExternalLink size={12} />
        </Link>
      )}
    </div>
  )
}

export function SourcesCard({ output }) {
  if (!output?.sources?.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {output.sources.map((s, i) => (
        <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 max-w-[220px] rounded-full bg-white/80 ring-1 ring-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:text-blue-700">
          <Globe size={11} className="shrink-0" /><span className="truncate">{s.title || new URL(s.url).hostname}</span>
        </a>
      ))}
    </div>
  )
}

const TOOL_ICON = {
  find: Search, client_account: Wallet, supplier_account: Wallet, balances: Wallet, money_report: BarChart3,
  list_projects: FolderPlus, project_details: FolderPlus, business_snapshot: BarChart3, query_data: Table2,
  recent_actions: Clock, compliance_overview: Shield, web_search: Globe, remember: Brain, forget: Brain,
  agent_settings: Settings2, undo_action: Undo2, open_page: ExternalLink,
}

/** Small "what I'm doing / what I looked at" chip for read tools. */
export function ToolChip({ name, state, t }) {
  const Icon = TOOL_ICON[name] || Sparkles
  const running = state === 'input-streaming' || state === 'input-available'
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 ring-1 ring-white px-2.5 py-1 text-[11.5px] text-slate-600 shadow-sm">
      {running ? <Loader2 size={12} className="animate-spin text-blue-600" /> : state === 'output-error' ? <AlertTriangle size={12} className="text-rose-600" /> : <Icon size={12} className="text-blue-700" />}
      {t(`agent.tool_${name}`)}
    </span>
  )
}
