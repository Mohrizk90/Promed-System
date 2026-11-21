import { useCallback, useEffect, useMemo, useState } from 'react'
import { Sparkles, Undo2, Check, X, Loader2, Mic, ChevronDown, Settings2, Activity, CheckCircle2, XCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { agentAction, agentErrorText, agentHealth } from '../../lib/agentApi'
import { useLanguage } from '../../context/LanguageContext'
import { useToast } from '../../context/ToastContext'
import useDataChanged from '../../hooks/useDataChanged'
import LoadingSpinner from '../LoadingSpinner'
import { Button, Field, PageHeader, inputClass, openAgent } from '../projects/shared'

const TONE = {
  applied: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  pending: 'bg-amber-50 text-amber-800 ring-amber-200',
  undone: 'bg-slate-100 text-slate-600 ring-slate-200',
  cancelled: 'bg-slate-100 text-slate-500 ring-slate-200',
  failed: 'bg-rose-50 text-rose-700 ring-rose-200',
}

function dayLabel(iso, language) {
  const d = new Date(iso)
  const now = new Date()
  const diff = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000)
  const ar = language === 'ar'
  if (diff === 0) return ar ? 'النهارده' : 'Today'
  if (diff === 1) return ar ? 'امبارح' : 'Yesterday'
  return d.toLocaleDateString(ar ? 'ar-EG' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

function Changes({ actionId, t }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    supabase.from('agent_changes').select('id, table_name, op, pk_val, before, after').eq('action_id', actionId).order('id')
      .then(({ data }) => setRows(data || []))
  }, [actionId])
  if (!rows) return <div className="py-2"><Loader2 size={14} className="animate-spin text-slate-400" /></div>
  return (
    <ul className="mt-2 space-y-1 text-[12px]">
      {rows.map((r) => {
        const diff = r.op === 'update' && r.before && r.after
          ? Object.keys(r.after).filter((k) => k !== 'updated_at' && JSON.stringify(r.before[k]) !== JSON.stringify(r.after[k]))
          : []
        return (
          <li key={r.id} className="rounded-lg bg-white/70 px-2 py-1">
            <span className={`font-medium ${r.op === 'insert' ? 'text-emerald-700' : r.op === 'delete' ? 'text-rose-700' : 'text-blue-700'}`}>{r.op}</span>{' '}
            <span className="text-slate-600">{t(`agent.table_${r.table_name}`)} #{r.pk_val}</span>
            {diff.length > 0 && (
              <span className="text-slate-500"> — {diff.slice(0, 4).map((k) => `${k}: ${JSON.stringify(r.before[k])} → ${JSON.stringify(r.after[k])}`).join(' · ')}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function SettingsCard() {
  const { t } = useLanguage()
  const toast = useToast()
  const [limit, setLimit] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    supabase.from('agent_settings').select('auto_save_limit').maybeSingle().then(({ data }) => setLimit(String(data?.auto_save_limit ?? 5000)))
  }, [])
  const save = async () => {
    setSaving(true)
    const { error } = await supabase.rpc('agent_set_settings', { p_auto_save_limit: Number(limit) || 0 })
    setSaving(false)
    if (error) toast.error(error.message)
    else toast.success(t('activity.saved'))
  }
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center gap-2 font-semibold text-[#0b2a55] mb-2"><Settings2 size={16} />{t('activity.settings')}</div>
      <div className="flex items-end gap-2">
        <Field label={t('activity.auto_limit')} className="flex-1">
          <input className={inputClass} type="number" min="0" step="500" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </Field>
        <Button onClick={save} disabled={saving}>{t('activity.save')}</Button>
      </div>
      <p className="text-[11.5px] text-slate-500 mt-1.5">{t('activity.auto_limit_hint')}</p>
    </div>
  )
}

function HealthCard() {
  const { t } = useLanguage()
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      setState(await agentHealth())
    } catch (e) {
      setState({ ok: false, error: agentErrorText(e, t) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center gap-2 font-semibold text-[#0b2a55] mb-1"><Activity size={16} />{t('activity.health')}</div>
      <p className="text-[11.5px] text-slate-500 mb-2.5">{t('activity.health_hint')}</p>
      {state && (
        <div className="mb-3 space-y-1.5">
          <div className={`flex items-start gap-2 rounded-xl px-2.5 py-2 text-[12.5px] ring-1 ${state.ok ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-rose-50 text-rose-800 ring-rose-200'}`}>
            {state.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : <XCircle size={15} className="mt-0.5 shrink-0" />}
            <span>{state.ok ? t('activity.health_ok') : (state.error || t(`agent.err_${state.code || 'generic'}`))}</span>
          </div>
          {(state.models || []).map((m) => (
            <div key={m.role} className="flex items-center justify-between gap-2 text-[12px] text-slate-600">
              <span className="min-w-0 truncate">{t(`activity.role_${m.role}`)} <span className="text-slate-400" dir="ltr">· {m.id}</span></span>
              {m.ok
                ? <span className="text-emerald-700 shrink-0">✓</span>
                : <span className="text-rose-700 shrink-0" title={m.message}>✗ {m.status || ''}</span>}
            </div>
          ))}
          {state.live && (
            <div className="flex items-center justify-between gap-2 text-[12px] text-slate-600">
              <span>{t('activity.health_live')}</span>
              {state.live.ok
                ? <span className="text-emerald-700" dir="ltr">✓ {(state.live.ms / 1000).toFixed(1)} s</span>
                : <span className="text-rose-700" title={state.live.message}>✗ {state.live.status || ''}</span>}
            </div>
          )}
        </div>
      )}
      <Button variant="secondary" onClick={run} disabled={busy}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}{t('activity.health_run')}
      </Button>
    </div>
  )
}

export default function AgentActivity() {
  const { t, language } = useLanguage()
  const toast = useToast()
  const [rows, setRows] = useState(null)
  const [filter, setFilter] = useState('all')
  const [open, setOpen] = useState(null)
  const [busy, setBusy] = useState(null)
  const [conflict, setConflict] = useState(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('agent_actions')
      .select('id, kind, summary, status, error, voice_text, created_at, applied_at, undone_at, preview')
      .order('created_at', { ascending: false }).limit(300)
    setRows(data || [])
  }, [])
  useEffect(() => { load() }, [load])
  useDataChanged(load)

  const run = async (op, id, force = false) => {
    setBusy(`${op}:${id}`)
    try {
      await agentAction(op, id, { force })
      toast.success(t(op === 'undo' ? 'activity.undone_ok' : op === 'confirm' ? 'activity.confirmed_ok' : 'activity.cancelled_ok'))
      setConflict(null)
      load()
    } catch (e) {
      if (op === 'undo' && /Cannot undo/.test(e.message)) setConflict(id)
      else toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  const filtered = useMemo(() => (rows || []).filter((r) => filter === 'all' || r.status === filter), [rows, filter])
  const groups = useMemo(() => {
    const m = new Map()
    filtered.forEach((r) => {
      const k = new Date(r.created_at).toDateString()
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(r)
    })
    return [...m.values()]
  }, [filtered])
  const counts = useMemo(() => (rows || []).reduce((c, r) => ({ ...c, [r.status]: (c[r.status] || 0) + 1 }), {}), [rows])

  if (rows === null) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner size="lg" /></div>

  return (
    <div className="pb-24 md:pb-6">
      <PageHeader title={t('activity.title')} subtitle={t('activity.subtitle')}
        actions={<Button variant="agent" onClick={openAgent}><Sparkles size={15} />{t('activity.open_chat')}</Button>} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2">
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-3">
            {['all', 'pending', 'applied', 'undone'].map((k) => (
              <button key={k} type="button" onClick={() => setFilter(k)}
                className={`shrink-0 px-3 h-8 rounded-full text-[12.5px] ring-1 ${filter === k ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white/70 ring-white text-slate-700'}`}>
                {t(`activity.${k}`)}{k !== 'all' && counts[k] ? <span className="opacity-70 ms-1">{counts[k]}</span> : null}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="glass rounded-2xl p-8 text-center text-slate-600 text-[14px]">{t('activity.empty')}</div>
          ) : groups.map((g) => (
            <section key={g[0].created_at} className="mb-4">
              <h2 className="text-[12px] font-semibold text-slate-500 mb-1.5 px-1">{dayLabel(g[0].created_at, language)}</h2>
              <div className="glass rounded-2xl divide-y divide-slate-200/60">
                {g.map((r) => (
                  <div key={r.id} className="px-3 sm:px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[13.5px] font-medium text-slate-800">{r.summary}</span>
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10.5px] font-medium ring-1 ${TONE[r.status] || TONE.pending}`}>{t(`agent.status_${r.status}`)}</span>
                        </div>
                        <div className="text-[11.5px] text-slate-400 mt-0.5">
                          {new Date(r.created_at).toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}
                          {' · '}{t(`agent.kind_${r.kind}`)}
                        </div>
                        {r.voice_text && (
                          <div className="mt-1 text-[12px] text-slate-500 inline-flex items-start gap-1"><Mic size={12} className="mt-0.5 shrink-0" />“{r.voice_text}”</div>
                        )}
                        {r.error && <div className="mt-1 text-[12px] text-rose-700">{r.error}</div>}
                        {conflict === r.id && (
                          <div className="mt-1.5 text-[12px] text-amber-800 bg-amber-50 rounded-lg px-2 py-1">
                            {t('agent.undo_conflict')}
                            <button type="button" className="ms-2 underline font-medium" onClick={() => run('undo', r.id, true)}>{t('agent.undo_force')}</button>
                          </div>
                        )}
                        {open === r.id && r.status !== 'pending' && <Changes actionId={r.id} t={t} />}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {r.status === 'pending' && (
                          <>
                            <Button className="!h-8 !px-2.5" onClick={() => run('confirm', r.id)} disabled={!!busy}>
                              {busy === `confirm:${r.id}` ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}{t('agent.confirm')}
                            </Button>
                            <Button variant="ghost" className="!h-8 !px-2" onClick={() => run('cancel', r.id)} disabled={!!busy} aria-label={t('agent.cancel')}><X size={15} /></Button>
                          </>
                        )}
                        {r.status === 'applied' && (
                          <Button variant="secondary" className="!h-8 !px-2.5" onClick={() => run('undo', r.id)} disabled={!!busy}>
                            {busy === `undo:${r.id}` ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}{t('agent.undo')}
                          </Button>
                        )}
                        {r.status !== 'pending' && r.status !== 'cancelled' && (
                          <Button variant="ghost" className="!h-8 !w-8 !px-0" onClick={() => setOpen(open === r.id ? null : r.id)} aria-label="details">
                            <ChevronDown size={16} className={open === r.id ? 'rotate-180 transition-transform' : 'transition-transform'} />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="space-y-3">
          <SettingsCard />
          <HealthCard />
        </div>
      </div>
    </div>
  )
}
