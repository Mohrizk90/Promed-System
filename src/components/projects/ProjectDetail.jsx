import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Trash2, Sparkles, TrendingUp, TrendingDown, Scale, PiggyBank } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../context/LanguageContext'
import { useToast } from '../../context/ToastContext'
import useDataChanged from '../../hooks/useDataChanged'
import ConfirmDialog from '../ui/ConfirmDialog'
import LoadingSpinner from '../LoadingSpinner'
import { Button, Stat, StatusPill, fmt, openAgent } from './shared'
import { ProjectForm, TypeBadge, typeName } from './ProjectsPage'

const RECORD_PATHS = {
  ledger_entry: '/money',
  client_transaction: '/',
  supplier_transaction: '/suppliers',
  liability: '/liabilities',
  payment: '/',
}

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t, language } = useLanguage()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [raw, setRaw] = useState(null)
  const [types, setTypes] = useState([])
  const [missing, setMissing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(async () => {
    const [{ data: ov, error }, { data: row }, { data: ty }] = await Promise.all([
      supabase.rpc('project_overview', { p_project: Number(id) }),
      supabase.from('projects').select('*').eq('id', id).maybeSingle(),
      supabase.from('project_types').select('*').is('deleted_at', null).order('id'),
    ])
    if (error || !ov) { setMissing(true); return }
    setData(ov)
    setRaw(row)
    setTypes(ty || [])
  }, [id])

  useEffect(() => { setData(null); setMissing(false); load() }, [load])
  useDataChanged(load)

  const remove = async () => {
    const { error } = await supabase.from('projects').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success(t('projects.deleted'))
    navigate('/projects')
  }

  if (missing) {
    return (
      <div className="glass rounded-2xl p-8 text-center">
        <p className="text-slate-600 mb-3">404</p>
        <Link to="/projects" className="text-blue-700 underline">{t('projects.back')}</Link>
      </div>
    )
  }
  if (!data) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner size="lg" /></div>

  const p = data.project
  const net = Number(p.net)
  const used = p.budget ? Math.round((Number(p.expense) / Number(p.budget)) * 100) : null
  const fields = (data.type_fields || []).filter((f) => data.attributes?.[f.key])
  const chart = (data.by_category || []).slice(0, 10).map((c) => ({
    name: c.category || '—',
    value: Number(c.total),
    direction: c.direction,
  }))
  const maxBar = Math.max(1, ...chart.map((c) => c.value))

  return (
    <div className="pb-24 md:pb-6">
      <Link to="/projects" className="inline-flex items-center gap-1 text-[13px] text-blue-700 mb-2">
        <ArrowLeft size={15} className="rtl:rotate-180" />{t('projects.back')}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-[#0b2a55] tracking-tight">{p.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <TypeBadge icon={p.icon} color={p.color} label={typeName(p, language)} />
            <StatusPill status={p.status} t={t} />
            {data.parent && <Link to={`/projects/${data.parent.id}`} className="text-[12px] text-blue-700">↑ {data.parent.name}</Link>}
            {data.client && <span className="text-[12px] text-slate-500">· {t('projects.client')}: {data.client.name}</span>}
            {(data.aliases || []).length > 0 && <span className="text-[12px] text-slate-400">· {data.aliases.join('، ')}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="agent" onClick={openAgent}><Sparkles size={15} />{t('projects.ask_agent')}</Button>
          <Button variant="secondary" onClick={() => setEditing(true)}><Pencil size={15} /></Button>
          <Button variant="danger" onClick={() => setConfirmDelete(true)} aria-label={t('projects.delete')}><Trash2 size={15} /></Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mb-4">
        <Stat icon={TrendingUp} label={t('projects.income')} value={fmt(p.income)} tone="green" />
        <Stat icon={TrendingDown} label={t('projects.expense')} value={fmt(p.expense)} tone="red" />
        <Stat icon={Scale} label={t('projects.net')} value={fmt(net)} tone={net >= 0 ? 'blue' : 'red'} />
        <Stat icon={PiggyBank} label={t('projects.budget')} value={p.budget ? fmt(p.budget) : '—'} hint={used !== null ? t('projects.of_budget', { p: used }) : undefined} tone={used !== null && used >= 90 ? 'red' : 'slate'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        <div className="lg:col-span-3 space-y-3">
          <section className="glass rounded-2xl p-4">
            <h2 className="font-semibold text-[#0b2a55] mb-2">{t('projects.by_category')}</h2>
            {chart.length === 0 ? (
              <p className="text-[13px] text-slate-500">{t('projects.no_records')}</p>
            ) : (
              <ul className="space-y-2.5">
                {chart.map((c, i) => (
                  <li key={i}>
                    <div className="flex items-baseline justify-between gap-2 text-[12.5px] mb-1">
                      <span className="text-slate-700 truncate">{c.name}</span>
                      <span className={`tabular-nums font-medium ${c.direction === 'income' ? 'text-emerald-700' : 'text-rose-700'}`}>{fmt(c.value)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-200/60 overflow-hidden">
                      <div className={`h-full rounded-full ${c.direction === 'income' ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${Math.max(2, (c.value / maxBar) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="glass rounded-2xl p-4">
            <h2 className="font-semibold text-[#0b2a55] mb-2">{t('projects.linked')} <span className="text-slate-400 font-normal text-[13px]">({data.records.length})</span></h2>
            {data.records.length === 0 ? (
              <p className="text-[13px] text-slate-500">{t('projects.no_records')}</p>
            ) : (
              <ul className="divide-y divide-slate-200/60">
                {data.records.map((r) => (
                  <li key={`${r.record_type}-${r.record_id}`}>
                    <Link to={RECORD_PATHS[r.record_type] || '#'} className="flex items-center gap-3 py-2.5 hover:bg-white/50 rounded-lg px-1">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${r.direction === 'income' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] text-slate-800 truncate">{r.label}</div>
                        <div className="text-[11.5px] text-slate-400">{t(`agent.record_${r.record_type}`)} · {r.date}{r.category ? ` · ${r.category}` : ''}</div>
                      </div>
                      <div dir="ltr" className={`tabular-nums font-semibold text-[13.5px] ${r.direction === 'income' ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {r.direction === 'income' ? '+' : '−'}{fmt(r.amount, 2)}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="lg:col-span-2 space-y-3">
          <section className="glass rounded-2xl p-4">
            <h2 className="font-semibold text-[#0b2a55] mb-2">{t('projects.details')}</h2>
            <dl className="text-[13px] space-y-1.5">
              {p.start_date && <Row k={t('projects.start')} v={p.start_date} />}
              {p.end_date && <Row k={t('projects.end')} v={p.end_date} />}
              {data.supplier && <Row k={t('projects.supplier')} v={data.supplier.name} />}
              {data.product && <Row k={t('projects.product')} v={data.product.name} />}
              {fields.map((f) => <Row key={f.key} k={language === 'ar' ? f.label_ar || f.label_en : f.label_en} v={String(data.attributes[f.key])} />)}
              {p.last_activity && <Row k={t('projects.last_activity')} v={p.last_activity} />}
            </dl>
            {data.notes && <p className="mt-3 text-[13px] text-slate-600 whitespace-pre-wrap">{data.notes}</p>}
          </section>

          {data.children.length > 0 && (
            <section className="glass rounded-2xl p-4">
              <h2 className="font-semibold text-[#0b2a55] mb-2">{t('projects.sub_projects')}</h2>
              <ul className="space-y-1">
                {data.children.map((c) => (
                  <li key={c.id}>
                    <Link to={`/projects/${c.id}`} className="flex justify-between gap-2 py-1.5 text-[13px] hover:text-blue-700">
                      <span className="truncate">{c.name}</span>
                      <span className={`tabular-nums ${Number(c.net) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmt(c.net)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {raw && <ProjectForm isOpen={editing} onClose={() => setEditing(false)} onSaved={load} types={types} project={raw} />}
      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title={t('projects.delete')}
        message={t('projects.delete_confirm')}
        confirmText={t('projects.delete')}
        cancelText={t('projects.cancel')}
      />
    </div>
  )
}

function Row({ k, v }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-slate-800 text-end truncate">{v}</dd>
    </div>
  )
}
