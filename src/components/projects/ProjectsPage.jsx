import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Handshake, Ship, Cpu, Layers, Wallet, Folder, Car, Building2, Plus, Search, Sparkles, Trash2, FolderPlus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../context/LanguageContext'
import { useToast } from '../../context/ToastContext'
import useDataChanged from '../../hooks/useDataChanged'
import Modal from '../ui/Modal'
import LoadingSpinner from '../LoadingSpinner'
import { Button, Field, PageHeader, Stat, StatusPill, TYPE_COLORS, fmt, inputClass, openAgent } from './shared'

export const TYPE_ICONS = { handshake: Handshake, ship: Ship, cpu: Cpu, layers: Layers, wallet: Wallet, folder: Folder, car: Car, building: Building2 }
export const typeName = (type, language) => (language === 'ar' ? type?.type_ar || type?.name_ar || type?.type_en || type?.name_en : type?.type_en || type?.name_en)

const STATUSES = ['active', 'on_hold', 'done', 'cancelled']

export function TypeBadge({ icon, color, label }) {
  const Icon = TYPE_ICONS[icon] || Folder
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${TYPE_COLORS[color] || TYPE_COLORS.slate}`}>
      <Icon size={12} />
      {label}
    </span>
  )
}

/** Create or edit a project (used by the list and the detail page). */
export function ProjectForm({ isOpen, onClose, onSaved, types, project = null }) {
  const { t, language } = useLanguage()
  const toast = useToast()
  const [clients, setClients] = useState([])
  const [parents, setParents] = useState([])
  const [saving, setSaving] = useState(false)
  const blank = { type_id: '', name: '', status: 'active', budget: '', start_date: '', end_date: '', client_id: '', parent_id: '', aliases: '', notes: '', attributes: {} }
  const [form, setForm] = useState(blank)

  useEffect(() => {
    if (!isOpen) return
    setForm(project ? {
      type_id: project.type_id, name: project.name, status: project.status, budget: project.budget ?? '',
      start_date: project.start_date || '', end_date: project.end_date || '', client_id: project.client_id || '',
      parent_id: project.parent_id || '', aliases: (project.aliases || []).join(', '), notes: project.notes || '',
      attributes: project.attributes || {},
    } : { ...blank, type_id: types.find((x) => x.key === 'deal')?.id || types[0]?.id || '' })
    supabase.from('clients').select('client_id, client_name').order('client_name').then(({ data }) => setClients(data || []))
    supabase.from('projects').select('id, name').is('deleted_at', null).order('name').then(({ data }) => setParents(data || []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, project?.id])

  const type = types.find((x) => String(x.id) === String(form.type_id))
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setAttr = (k) => (e) => setForm((f) => ({ ...f, attributes: { ...f.attributes, [k]: e.target.value } }))

  const save = async () => {
    if (!form.name.trim() || !form.type_id) return
    setSaving(true)
    const row = {
      type_id: Number(form.type_id),
      name: form.name.trim(),
      status: form.status,
      budget: form.budget === '' ? null : Number(form.budget),
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      client_id: form.client_id ? Number(form.client_id) : null,
      parent_id: form.parent_id ? Number(form.parent_id) : null,
      aliases: form.aliases.split(/[,،]/).map((s) => s.trim()).filter(Boolean),
      notes: form.notes || null,
      attributes: Object.fromEntries(Object.entries(form.attributes).filter(([, v]) => v !== '' && v != null)),
    }
    const q = project ? supabase.from('projects').update(row).eq('id', project.id).select('id').single() : supabase.from('projects').insert(row).select('id').single()
    const { data, error } = await q
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success(project ? t('projects.saved') : t('projects.created'))
    onSaved?.(data.id)
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={project ? project.name : t('projects.new')} size="lg"
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t('projects.cancel')}</Button>
          <Button onClick={save} disabled={saving || !form.name.trim()}>{project ? t('projects.save') : t('projects.create')}</Button>
        </div>
      )}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t('projects.name')} className="sm:col-span-2">
          <input className={inputClass} value={form.name} onChange={set('name')} autoFocus />
        </Field>
        <Field label={t('projects.type')}>
          <select className={inputClass} value={form.type_id} onChange={set('type_id')}>
            {types.map((x) => <option key={x.id} value={x.id}>{typeName(x, language)}</option>)}
          </select>
        </Field>
        <Field label={t('projects.status')}>
          <select className={inputClass} value={form.status} onChange={set('status')}>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`projects.status_${s}`)}</option>)}
          </select>
        </Field>
        <Field label={t('projects.budget')}>
          <input className={inputClass} type="number" inputMode="decimal" value={form.budget} onChange={set('budget')} />
        </Field>
        <Field label={t('projects.client')}>
          <select className={inputClass} value={form.client_id} onChange={set('client_id')}>
            <option value="">—</option>
            {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
          </select>
        </Field>
        <Field label={t('projects.start')}>
          <input className={inputClass} type="date" value={form.start_date} onChange={set('start_date')} />
        </Field>
        <Field label={t('projects.end')}>
          <input className={inputClass} type="date" value={form.end_date} onChange={set('end_date')} />
        </Field>
        <Field label={t('projects.parent')}>
          <select className={inputClass} value={form.parent_id} onChange={set('parent_id')}>
            <option value="">—</option>
            {parents.filter((p) => p.id !== project?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label={t('projects.aliases')}>
          <input className={inputClass} value={form.aliases} onChange={set('aliases')} />
        </Field>
        {(type?.fields || []).map((f) => (
          <Field key={f.key} label={language === 'ar' ? f.label_ar || f.label_en : f.label_en}>
            {f.type === 'select' ? (
              <select className={inputClass} value={form.attributes[f.key] || ''} onChange={setAttr(f.key)}>
                <option value="">—</option>
                {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input className={inputClass} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} value={form.attributes[f.key] || ''} onChange={setAttr(f.key)} />
            )}
          </Field>
        ))}
        <Field label={t('projects.notes')} className="sm:col-span-2">
          <textarea className={`${inputClass} h-20 py-2`} value={form.notes} onChange={set('notes')} />
        </Field>
      </div>
    </Modal>
  )
}

function TypeForm({ isOpen, onClose, onSaved }) {
  const { t } = useLanguage()
  const toast = useToast()
  const [nameEn, setNameEn] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [color, setColor] = useState('indigo')
  const [icon, setIcon] = useState('folder')
  const [fields, setFields] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (isOpen) { setNameEn(''); setNameAr(''); setFields([]); setColor('indigo'); setIcon('folder') } }, [isOpen])

  const save = async () => {
    if (!nameEn.trim() && !nameAr.trim()) return
    setSaving(true)
    const en = nameEn.trim() || nameAr.trim()
    const key = `${en.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'type'}_${Date.now().toString(36).slice(-4)}`
    const { error } = await supabase.from('project_types').insert({
      key, name_en: en, name_ar: nameAr.trim() || null, color, icon,
      fields: fields.filter((f) => f.label.trim()).map((f, i) => ({ key: `f${i + 1}_${f.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 20) || 'x'}`, label_en: f.label.trim(), label_ar: f.label.trim(), type: f.type })),
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success(t('projects.type_created'))
    onSaved?.()
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('projects.new_type')} size="md"
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t('projects.cancel')}</Button>
          <Button onClick={save} disabled={saving || (!nameEn.trim() && !nameAr.trim())}>{t('projects.create')}</Button>
        </div>
      )}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('projects.type_name_en')}><input className={inputClass} value={nameEn} onChange={(e) => setNameEn(e.target.value)} autoFocus /></Field>
          <Field label={t('projects.type_name_ar')}><input className={inputClass} value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" /></Field>
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.keys(TYPE_ICONS).map((k) => {
            const Icon = TYPE_ICONS[k]
            return (
              <button key={k} type="button" onClick={() => setIcon(k)} className={`w-9 h-9 rounded-xl flex items-center justify-center ring-1 ${icon === k ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white ring-slate-200 text-slate-600'}`} aria-label={k}>
                <Icon size={17} />
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          {['blue', 'indigo', 'violet', 'teal', 'emerald', 'amber', 'orange', 'rose', 'slate'].map((c) => (
            <button key={c} type="button" onClick={() => setColor(c)} className={`px-2.5 h-7 rounded-full text-[11px] ${TYPE_COLORS[c]} ${color === c ? 'ring-2 ring-offset-1 ring-blue-500' : ''}`}>{c}</button>
          ))}
        </div>
        <div>
          <div className="text-[12px] font-medium text-slate-600 mb-1">{t('projects.fields')}</div>
          <div className="space-y-2">
            {fields.map((f, i) => (
              <div key={i} className="flex gap-2">
                <input className={inputClass} placeholder={t('projects.field_label')} value={f.label} onChange={(e) => setFields((fs) => fs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <select className={`${inputClass} !w-32`} value={f.type} onChange={(e) => setFields((fs) => fs.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
                  <option value="text">{t('projects.field_text')}</option>
                  <option value="number">{t('projects.field_number')}</option>
                  <option value="date">{t('projects.field_date')}</option>
                </select>
                <Button variant="danger" onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))} aria-label="remove"><Trash2 size={15} /></Button>
              </div>
            ))}
            <Button variant="secondary" onClick={() => setFields((fs) => [...fs, { label: '', type: 'text' }])}><Plus size={15} />{t('projects.add_field')}</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default function ProjectsPage() {
  const { t, language } = useLanguage()
  const [types, setTypes] = useState([])
  const [rows, setRows] = useState(null)
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('open')
  const [q, setQ] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showType, setShowType] = useState(false)

  const load = useCallback(async () => {
    const [{ data: ty }, { data: pr }] = await Promise.all([
      supabase.from('project_types').select('*').is('deleted_at', null).order('id'),
      supabase.from('v_project_totals').select('*').order('last_activity', { ascending: false, nullsFirst: false }),
    ])
    setTypes(ty || [])
    setRows(pr || [])
  }, [])

  useEffect(() => { load() }, [load])
  useDataChanged(load)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (rows || []).filter((r) => (typeFilter === 'all' || String(r.type_id) === String(typeFilter))
      && (statusFilter === 'all' || (statusFilter === 'open' ? ['active', 'on_hold'].includes(r.status) : r.status === statusFilter))
      && (!needle || r.name.toLowerCase().includes(needle)))
  }, [rows, typeFilter, statusFilter, q])

  const totals = useMemo(() => filtered.reduce((a, r) => ({ income: a.income + Number(r.income), expense: a.expense + Number(r.expense) }), { income: 0, expense: 0 }), [filtered])

  if (rows === null) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner size="lg" /></div>

  return (
    <div className="pb-24 md:pb-6">
      <PageHeader
        title={t('projects.title')}
        subtitle={t('projects.subtitle')}
        actions={(
          <>
            <Button variant="secondary" onClick={() => setShowType(true)}><FolderPlus size={15} />{t('projects.new_type')}</Button>
            <Button onClick={() => setShowNew(true)}><Plus size={16} />{t('projects.new')}</Button>
          </>
        )}
      />

      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
        <Stat label={t('projects.income')} value={fmt(totals.income)} tone="green" />
        <Stat label={t('projects.expense')} value={fmt(totals.expense)} tone="red" />
        <Stat label={t('projects.net')} value={fmt(totals.income - totals.expense)} tone={totals.income - totals.expense >= 0 ? 'blue' : 'red'} />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400" />
          <input className={`${inputClass} ps-9`} placeholder={t('projects.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={`${inputClass} !w-auto`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="open">{`${t('projects.status_active')} + ${t('projects.status_on_hold')}`}</option>
          <option value="all">{t('money.both')}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`projects.status_${s}`)}</option>)}
        </select>
      </div>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-2 mb-2 -mx-1 px-1">
        <button type="button" onClick={() => setTypeFilter('all')} className={`shrink-0 px-3 h-8 rounded-full text-[12.5px] ring-1 ${typeFilter === 'all' ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white/70 ring-white text-slate-700'}`}>{t('projects.all_types')}</button>
        {types.map((ty) => {
          const Icon = TYPE_ICONS[ty.icon] || Folder
          const n = (rows || []).filter((r) => r.type_id === ty.id).length
          return (
            <button key={ty.id} type="button" onClick={() => setTypeFilter(ty.id)} className={`shrink-0 inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-[12.5px] ring-1 ${String(typeFilter) === String(ty.id) ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white/70 ring-white text-slate-700'}`}>
              <Icon size={13} />{typeName(ty, language)}<span className="opacity-60">{n}</span>
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="glass rounded-2xl p-8 text-center">
          <p className="text-slate-600 text-[14px] mb-3">{t('projects.empty')}</p>
          <Button variant="agent" onClick={openAgent}><Sparkles size={15} />{t('agent.open')}</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((r) => {
            const net = Number(r.net)
            const used = r.budget ? Math.min(100, Math.round((Number(r.expense) / Number(r.budget)) * 100)) : null
            return (
              <Link key={r.project_id} to={`/projects/${r.project_id}`} className="glass rounded-2xl p-4 hover:bg-white/90 transition-colors block">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-[15px] text-[#0b2a55] truncate">{r.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <TypeBadge icon={r.icon} color={r.color} label={typeName(r, language)} />
                      <StatusPill status={r.status} t={t} />
                    </div>
                  </div>
                  <div className={`text-end shrink-0 font-bold tabular-nums ${net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {fmt(net)}
                    <div className="text-[10.5px] font-normal text-slate-400">{t('projects.net')}</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[12px]">
                  <div><div className="text-slate-400">{t('projects.income')}</div><div className="tabular-nums text-slate-700">{fmt(r.income)}</div></div>
                  <div><div className="text-slate-400">{t('projects.expense')}</div><div className="tabular-nums text-slate-700">{fmt(r.expense)}</div></div>
                  <div><div className="text-slate-400">{t('projects.records')}</div><div className="tabular-nums text-slate-700">{r.records}</div></div>
                </div>
                {used !== null && (
                  <div className="mt-3">
                    <div className="h-1.5 rounded-full bg-slate-200/70 overflow-hidden">
                      <div className={`h-full rounded-full ${used >= 90 ? 'bg-rose-500' : 'bg-blue-500'}`} style={{ width: `${used}%` }} />
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">{t('projects.of_budget', { p: used })} · {fmt(r.budget)}</div>
                  </div>
                )}
              </Link>
            )
          })}
        </div>
      )}

      <ProjectForm isOpen={showNew} onClose={() => setShowNew(false)} onSaved={load} types={types} />
      <TypeForm isOpen={showType} onClose={() => setShowType(false)} onSaved={load} />
    </div>
  )
}
