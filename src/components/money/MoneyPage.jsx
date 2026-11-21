import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, Sparkles, TrendingUp, TrendingDown, Scale, Trash2, FileDown, FileSpreadsheet, Bot, Mic } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../context/LanguageContext'
import { useToast } from '../../context/ToastContext'
import useDataChanged from '../../hooks/useDataChanged'
import { downloadCsv } from '../../utils/exportCsv'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import LoadingSpinner from '../LoadingSpinner'
import { Button, Field, PageHeader, Stat, fmt, inputClass, openAgent, today } from '../projects/shared'

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10) }
const catName = (row, ar) => (ar ? row.category_ar || row.category_en : row.category_en) || '—'

function EntryForm({ isOpen, onClose, onSaved, categories, accounts, projects }) {
  const { t, language } = useLanguage()
  const toast = useToast()
  const ar = language === 'ar'
  const blank = { kind: 'expense', amount: '', entry_date: today(), category_id: '', account_id: '', description: '', party_name: '', project_id: '', share: '100' }
  const [form, setForm] = useState(blank)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (isOpen) setForm({ ...blank, account_id: accounts.find((a) => a.kind === 'cash')?.id || '' }) }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = async () => {
    const amount = Number(form.amount)
    if (!(amount > 0)) return
    setSaving(true)
    const { data, error } = await supabase.from('ledger_entries').insert({
      kind: form.kind,
      amount,
      entry_date: form.entry_date || today(),
      category_id: form.category_id ? Number(form.category_id) : null,
      account_id: form.account_id ? Number(form.account_id) : null,
      description: form.description || null,
      party_name: form.party_name || null,
      source: 'manual',
    }).select('id').single()
    if (!error && form.project_id) {
      const { error: linkErr } = await supabase.from('record_links').insert({ project_id: Number(form.project_id), record_type: 'ledger_entry', record_id: data.id, share_pct: Number(form.share) || 100 })
      if (linkErr) toast.error(linkErr.message)
    }
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success(t('money.saved'))
    onSaved?.()
    onClose()
  }

  const cats = categories.filter((c) => c.kind === 'both' || c.kind === form.kind)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('money.add')} size="md"
      footer={(
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => { onClose(); openAgent() }} className="text-[12px] text-indigo-700 inline-flex items-center gap-1"><Mic size={13} />{t('money.quick_voice')}</button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>{t('money.cancel')}</Button>
            <Button onClick={save} disabled={saving || !(Number(form.amount) > 0)}>{t('money.save')}</Button>
          </div>
        </div>
      )}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100">
          {['expense', 'income'].map((k) => (
            <button key={k} type="button" onClick={() => setForm((f) => ({ ...f, kind: k, category_id: '' }))}
              className={`h-9 rounded-lg text-[13.5px] font-medium ${form.kind === k ? (k === 'expense' ? 'bg-white text-rose-700 shadow-sm' : 'bg-white text-emerald-700 shadow-sm') : 'text-slate-500'}`}>
              {t(`money.${k}`)}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('money.amount')}><input className={`${inputClass} text-lg font-semibold`} type="number" inputMode="decimal" value={form.amount} onChange={set('amount')} autoFocus /></Field>
          <Field label={t('money.date')}><input className={inputClass} type="date" value={form.entry_date} onChange={set('entry_date')} /></Field>
          <Field label={t('money.category')}>
            <select className={inputClass} value={form.category_id} onChange={set('category_id')}>
              <option value="">—</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{ar ? c.name_ar || c.name_en : c.name_en}</option>)}
            </select>
          </Field>
          <Field label={t('money.account')}>
            <select className={inputClass} value={form.account_id} onChange={set('account_id')}>
              <option value="">—</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t('money.description')}><input className={inputClass} value={form.description} onChange={set('description')} /></Field>
        <Field label={t('money.party')}><input className={inputClass} value={form.party_name} onChange={set('party_name')} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('money.project')} className="col-span-2">
            <select className={inputClass} value={form.project_id} onChange={set('project_id')}>
              <option value="">{t('money.none')}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="%"><input className={inputClass} type="number" min="1" max="100" value={form.share} onChange={set('share')} disabled={!form.project_id} /></Field>
        </div>
      </div>
    </Modal>
  )
}

export default function MoneyPage() {
  const { t, language } = useLanguage()
  const toast = useToast()
  const ar = language === 'ar'
  const [rows, setRows] = useState(null)
  const [categories, setCategories] = useState([])
  const [accounts, setAccounts] = useState([])
  const [projects, setProjects] = useState([])
  const [kind, setKind] = useState('all')
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())
  const [category, setCategory] = useState('')
  const [account, setAccount] = useState('')
  const [project, setProject] = useState('')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState(null)

  const loadLists = useCallback(async () => {
    const [c, a, p] = await Promise.all([
      supabase.from('categories').select('id, name_en, name_ar, kind').is('deleted_at', null).order('name_en'),
      supabase.from('money_accounts').select('id, name, kind').is('deleted_at', null).order('id'),
      supabase.from('projects').select('id, name').is('deleted_at', null).in('status', ['active', 'on_hold']).order('name'),
    ])
    setCategories(c.data || [])
    setAccounts(a.data || [])
    setProjects(p.data || [])
  }, [])

  const load = useCallback(async () => {
    let query = supabase.from('v_ledger').select('*').order('entry_date', { ascending: false }).order('id', { ascending: false }).limit(2000)
    if (from) query = query.gte('entry_date', from)
    if (to) query = query.lte('entry_date', to)
    const { data, error } = await query
    if (error) toast.error(error.message)
    setRows(data || [])
  }, [from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadLists() }, [loadLists])
  useEffect(() => { load() }, [load])
  useDataChanged(() => { load(); loadLists() })

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (rows || []).filter((r) => (kind === 'all' || r.kind === kind)
      && (!category || String(r.category_id) === category)
      && (!account || String(r.account_id) === account)
      && (!project || (r.projects || []).some((p) => String(p.project_id) === project))
      && (!needle || [r.description, r.party_name, r.client_name, r.supplier_name, r.employee_name, r.category_en, r.category_ar, r.notes]
        .some((v) => v && String(v).toLowerCase().includes(needle))))
  }, [rows, kind, category, account, project, q])

  const sums = useMemo(() => filtered.reduce((s, r) => {
    s[r.kind] += Number(r.amount)
    return s
  }, { income: 0, expense: 0 }), [filtered])

  const topCats = useMemo(() => {
    const m = new Map()
    filtered.filter((r) => r.kind === 'expense').forEach((r) => {
      const k = catName(r, ar)
      m.set(k, (m.get(k) || 0) + Number(r.amount))
    })
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [filtered, ar])

  const exportRows = () => filtered.map((r) => ({
    date: r.entry_date, kind: t(`money.${r.kind}`), amount: Number(r.amount), category: catName(r, ar), account: r.account_name || '',
    description: r.description || '', party: r.party_name || r.client_name || r.supplier_name || r.employee_name || '',
    projects: (r.projects || []).map((p) => `${p.name}${Number(p.share_pct) !== 100 ? ` (${p.share_pct}%)` : ''}`).join('; '),
  }))

  const exportPdf = async () => {
    const { exportTablePdf } = await import('../../utils/exportTablePdf')
    const data = exportRows()
    await exportTablePdf(`${t('money.title')} ${from || ''} – ${to || ''}`, Object.keys(data[0] || { date: 1 }), data)
  }

  const remove = async () => {
    const { error } = await supabase.from('ledger_entries').update({ deleted_at: new Date().toISOString() }).eq('id', deleting.id)
    setDeleting(null)
    if (error) { toast.error(error.message); return }
    toast.success(t('money.deleted'))
    load()
  }

  if (rows === null) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner size="lg" /></div>
  const net = sums.income - sums.expense

  return (
    <div className="pb-24 md:pb-6">
      <PageHeader
        title={t('money.title')}
        subtitle={t('money.subtitle')}
        actions={(
          <>
            <Button variant="secondary" onClick={() => downloadCsv(`money_${from}_${to}.csv`, exportRows())} disabled={!filtered.length}><FileSpreadsheet size={15} />CSV</Button>
            <Button variant="secondary" onClick={exportPdf} disabled={!filtered.length}><FileDown size={15} />PDF</Button>
            <Button variant="agent" onClick={openAgent}><Sparkles size={15} /><span className="hidden sm:inline">{t('agent.open')}</span></Button>
            <Button onClick={() => setAdding(true)}><Plus size={16} />{t('money.add')}</Button>
          </>
        )}
      />

      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-3">
        <Stat icon={TrendingUp} label={t('money.income')} value={fmt(sums.income)} tone="green" />
        <Stat icon={TrendingDown} label={t('money.expense')} value={fmt(sums.expense)} tone="red" />
        <Stat icon={Scale} label={t('money.net')} value={fmt(net)} tone={net >= 0 ? 'blue' : 'red'} hint={t('money.entries', { n: filtered.length })} />
      </div>

      {topCats.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-2 mb-1 -mx-1 px-1">
          {topCats.map(([name, total]) => (
            <span key={name} className="shrink-0 inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-white/70 ring-1 ring-white text-[12.5px] text-slate-700">
              {name}<span className="tabular-nums text-rose-700 font-medium">{fmt(total)}</span>
            </span>
          ))}
        </div>
      )}

      <div className="glass rounded-2xl p-3 mb-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100/80 shrink-0">
            {['all', 'expense', 'income'].map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} className={`px-3 h-8 rounded-lg text-[12.5px] font-medium ${kind === k ? 'bg-white shadow-sm text-[#0b2a55]' : 'text-slate-500'}`}>
                {k === 'all' ? t('money.both') : t(`money.${k}`)}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[180px]">
            <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400" />
            <input className={`${inputClass} ps-9`} placeholder={t('money.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Field label={t('money.from')}><input className={inputClass} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t('money.to')}><input className={inputClass} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label={t('money.category')}>
            <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">{t('money.any')}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{ar ? c.name_ar || c.name_en : c.name_en}</option>)}
            </select>
          </Field>
          <Field label={t('money.account')}>
            <select className={inputClass} value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">{t('money.any')}</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label={t('money.project')} className="col-span-2 sm:col-span-1">
            <select className={inputClass} value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">{t('money.any')}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="glass rounded-2xl p-8 text-center text-slate-600 text-[14px]">
          <p className="mb-3">{t('money.empty')}</p>
          <Button variant="agent" onClick={openAgent}><Sparkles size={15} />{t('money.quick_voice')}</Button>
        </div>
      ) : (
        <div className="glass rounded-2xl overflow-hidden">
          <ul className="divide-y divide-slate-200/60">
            {filtered.map((r) => (
              <li key={r.id} className="group flex items-center gap-3 px-3 sm:px-4 py-2.5 hover:bg-white/50">
                <span className={`w-9 h-9 rounded-xl shrink-0 flex items-center justify-center ${r.kind === 'income' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                  {r.kind === 'income' ? <TrendingUp size={17} /> : <TrendingDown size={17} />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] text-slate-800 truncate">
                    {r.description || catName(r, ar)}
                    {(r.party_name || r.client_name || r.supplier_name || r.employee_name) && <span className="text-slate-400"> · {r.party_name || r.client_name || r.supplier_name || r.employee_name}</span>}
                  </div>
                  <div className="text-[11.5px] text-slate-400 flex flex-wrap items-center gap-x-1.5">
                    <span>{r.entry_date}</span>
                    <span>· {catName(r, ar)}</span>
                    {r.account_name && <span>· {r.account_name}</span>}
                    {r.source === 'agent' && <span className="inline-flex items-center gap-0.5 text-indigo-600"><Bot size={11} />{t('money.source_agent')}</span>}
                    {(r.projects || []).map((p) => (
                      <Link key={p.project_id} to={`/projects/${p.project_id}`} className="px-1.5 rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-100">
                        {p.name}{Number(p.share_pct) !== 100 ? ` ${Number(p.share_pct)}%` : ''}
                      </Link>
                    ))}
                  </div>
                  {r.voice_text && <div className="text-[11.5px] text-slate-400 italic truncate">“{r.voice_text}”</div>}
                </div>
                <div dir="ltr" className={`tabular-nums font-semibold text-[14px] ${r.kind === 'income' ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {r.kind === 'income' ? '+' : '−'}{fmt(r.amount, 2)}
                </div>
                <button type="button" onClick={() => setDeleting(r)} className="w-8 h-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center sm:opacity-0 sm:group-hover:opacity-100" aria-label="delete">
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <EntryForm isOpen={adding} onClose={() => setAdding(false)} onSaved={load} categories={categories} accounts={accounts} projects={projects} />
      <ConfirmDialog isOpen={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} title={t('money.delete_confirm')}
        message={deleting ? `${deleting.description || catName(deleting, ar)} · ${fmt(deleting.amount, 2)}` : ''} confirmText={t('agent.confirm')} cancelText={t('money.cancel')} />
    </div>
  )
}
