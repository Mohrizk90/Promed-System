// Bills of materials: what each device is made of and what it costs to build.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Trash2, Sparkles, Layers, Search, Save, Pencil } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../context/LanguageContext'
import { useToast } from '../../context/ToastContext'
import useDataChanged from '../../hooks/useDataChanged'
import LoadingSpinner from '../LoadingSpinner'
import { Button, Field, PageHeader, Stat, fmt, inputClass, openAgent } from '../projects/shared'

const lineTotal = (l) => Number(l.quantity || 0) * Number(l.unit_cost || 0)
const cellInput = 'input w-full px-2 h-9 text-[13px] outline-none'

function BomForm({ products, initial, onSave, onCancel, t }) {
  const [name, setName] = useState(initial?.name || '')
  const [productId, setProductId] = useState(initial?.product_id ? String(initial.product_id) : '')
  const [notes, setNotes] = useState(initial?.notes || '')
  return (
    <div className="glass rounded-2xl p-4 space-y-3">
      <Field label={t('boms.name')}><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label={t('boms.product')}>
        <select className={inputClass} value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">{t('boms.no_product')}</option>
          {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.product_name}</option>)}
        </select>
      </Field>
      <Field label={t('boms.notes')}><input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onCancel}>{t('boms.cancel')}</Button>
        <Button disabled={!name.trim()} onClick={() => onSave({ name: name.trim(), product_id: productId ? Number(productId) : null, notes: notes.trim() || null })}>
          <Save size={14} />{t('boms.save')}
        </Button>
      </div>
    </div>
  )
}

function LineRow({ line, onChange, onDelete, t }) {
  const [draft, setDraft] = useState(line)
  useEffect(() => setDraft(line), [line])
  const dirty = draft.component_name !== line.component_name || String(draft.quantity) !== String(line.quantity) || String(draft.unit_cost) !== String(line.unit_cost)
  const commit = () => {
    if (!dirty) return
    if (!String(draft.component_name || '').trim() || !(Number(draft.quantity) > 0) || Number(draft.unit_cost) < 0) { setDraft(line); return }
    onChange(line.id, { component_name: draft.component_name.trim(), quantity: Number(draft.quantity), unit_cost: Number(draft.unit_cost) })
  }
  const keys = (e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setDraft(line) }
  return (
    <tr className="border-t border-slate-200/70">
      <td className="py-1.5 pe-2 min-w-[160px]"><input className={cellInput} value={draft.component_name || ''} onChange={(e) => setDraft({ ...draft, component_name: e.target.value })} onBlur={commit} onKeyDown={keys} aria-label={t('boms.component')} /></td>
      <td className="py-1.5 pe-2 w-20"><input className={cellInput} dir="ltr" type="number" min="0" step="any" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} onBlur={commit} onKeyDown={keys} aria-label={t('boms.qty')} /></td>
      <td className="py-1.5 pe-2 w-28"><input className={cellInput} dir="ltr" type="number" min="0" step="any" value={draft.unit_cost} onChange={(e) => setDraft({ ...draft, unit_cost: e.target.value })} onBlur={commit} onKeyDown={keys} aria-label={t('boms.unit_cost')} /></td>
      <td className="py-1.5 pe-2 w-28 text-end font-semibold tabular-nums text-slate-800" dir="ltr">{fmt(lineTotal(draft), 2)}</td>
      <td className="py-1.5 w-10 text-end">
        <button type="button" onClick={() => onDelete(line.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50" title={t('boms.delete_line')} aria-label={t('boms.delete_line')}><Trash2 size={15} /></button>
      </td>
    </tr>
  )
}

export default function BomsPage() {
  const { t } = useLanguage()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [boms, setBoms] = useState(null)
  const [products, setProducts] = useState([])
  const [lines, setLines] = useState([])
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState(null) // 'new' | 'edit'
  const [units, setUnits] = useState('1')
  const [newLine, setNewLine] = useState({ component_name: '', quantity: '1', unit_cost: '' })

  const selectedId = Number(params.get('id')) || null
  const select = (id) => setParams(id ? { id: String(id) } : {}, { replace: true })

  const loadBoms = useCallback(async () => {
    const [{ data, error }, { data: prods }] = await Promise.all([
      supabase.from('boms').select('id, name, product_id, notes, updated_at, bom_lines(quantity, unit_cost)').is('deleted_at', null).order('updated_at', { ascending: false }),
      supabase.from('products').select('product_id, product_name').order('product_name'),
    ])
    if (error) { toast.error(error.message); setBoms([]); return }
    setBoms(data || [])
    setProducts(prods || [])
  }, [toast])

  const loadLines = useCallback(async () => {
    if (!selectedId) { setLines([]); return }
    const { data, error } = await supabase.from('bom_lines').select('id, component_name, component_product_id, quantity, unit_cost, notes').eq('bom_id', selectedId).order('id')
    if (error) toast.error(error.message)
    setLines(data || [])
  }, [selectedId, toast])

  useEffect(() => { loadBoms() }, [loadBoms])
  useEffect(() => { loadLines() }, [loadLines])
  useDataChanged(() => { loadBoms(); loadLines() })

  useEffect(() => {
    if (boms?.length && !selectedId && mode !== 'new' && window.matchMedia('(min-width: 1024px)').matches) select(boms[0].id)
  }, [boms]) // eslint-disable-line react-hooks/exhaustive-deps

  const productName = useMemo(() => Object.fromEntries(products.map((p) => [p.product_id, p.product_name])), [products])
  const current = boms?.find((b) => b.id === selectedId) || null
  const total = lines.reduce((s, l) => s + lineTotal(l), 0)
  const n = Math.max(0, Number(units) || 0)
  const filtered = (boms || []).filter((b) => !search.trim() || `${b.name} ${productName[b.product_id] || ''}`.toLowerCase().includes(search.trim().toLowerCase()))

  const touch = async () => { if (selectedId) await supabase.from('boms').update({ updated_at: new Date().toISOString() }).eq('id', selectedId); loadBoms() }

  const saveBom = async (values) => {
    if (mode === 'new') {
      const { data, error } = await supabase.from('boms').insert(values).select('id').single()
      if (error) return toast.error(error.message)
      setMode(null); await loadBoms(); select(data.id)
    } else {
      const { error } = await supabase.from('boms').update(values).eq('id', selectedId)
      if (error) return toast.error(error.message)
      setMode(null); loadBoms()
    }
    toast.success(t('boms.saved'))
  }

  const deleteBom = async () => {
    if (!window.confirm?.(t('boms.delete_confirm'))) return
    const { error } = await supabase.from('boms').update({ deleted_at: new Date().toISOString() }).eq('id', selectedId)
    if (error) return toast.error(error.message)
    select(null); loadBoms(); toast.success(t('boms.deleted'))
  }

  const updateLine = async (id, values) => {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...values } : l)))
    const { error } = await supabase.from('bom_lines').update(values).eq('id', id)
    if (error) { toast.error(error.message); loadLines() } else touch()
  }

  const deleteLine = async (id) => {
    const { error } = await supabase.from('bom_lines').delete().eq('id', id)
    if (error) return toast.error(error.message)
    setLines((ls) => ls.filter((l) => l.id !== id)); touch()
  }

  const addLine = async () => {
    const name = newLine.component_name.trim()
    const qty = Number(newLine.quantity), cost = Number(newLine.unit_cost || 0)
    if (!name || !(qty > 0) || cost < 0) return toast.error(t('boms.line_invalid'))
    const { error } = await supabase.from('bom_lines').insert({ bom_id: selectedId, component_name: name, quantity: qty, unit_cost: cost })
    if (error) return toast.error(error.message)
    setNewLine({ component_name: '', quantity: '1', unit_cost: '' }); loadLines(); touch()
  }

  if (boms === null) return <LoadingSpinner />

  return (
    <div className="pb-24">
      <PageHeader
        title={t('boms.title')}
        subtitle={t('boms.subtitle')}
        actions={<>
          <Button variant="agent" onClick={openAgent}><Sparkles size={14} />{t('boms.ask_agent')}</Button>
          <Button onClick={() => { setMode('new'); select(null) }}><Plus size={14} />{t('boms.new')}</Button>
        </>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* List */}
        <div className={`space-y-2 ${selectedId || mode === 'new' ? 'hidden lg:block' : ''}`}>
          <div className="relative">
            <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400" />
            <input className={`${inputClass} ps-9`} placeholder={t('boms.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {filtered.length === 0 && (
            <div className="glass rounded-2xl p-6 text-center text-[13px] text-slate-500">
              <Layers className="mx-auto mb-2 text-slate-400" size={22} />{t('boms.empty')}
            </div>
          )}
          {filtered.map((b) => {
            const cost = (b.bom_lines || []).reduce((s, l) => s + lineTotal(l), 0)
            const active = b.id === selectedId
            return (
              <button key={b.id} type="button" onClick={() => { setMode(null); select(b.id) }}
                className={`w-full text-start glass rounded-2xl px-4 py-3 transition ring-1 ${active ? 'ring-blue-400 bg-blue-50/60' : 'ring-transparent hover:ring-slate-200'}`}>
                <div className="font-semibold text-[#0b2a55] truncate">{b.name}</div>
                <div className="text-[12px] text-slate-500 truncate">{productName[b.product_id] || t('boms.no_product')}</div>
                <div className="mt-1 flex items-center justify-between text-[12px]">
                  <span className="text-slate-500">{t('boms.n_lines', { n: (b.bom_lines || []).length })}</span>
                  <span className="font-semibold text-slate-800 tabular-nums" dir="ltr">{fmt(cost)} EGP</span>
                </div>
              </button>
            )
          })}
        </div>

        {/* Detail */}
        <div className="lg:col-span-2 space-y-3 min-w-0">
          {mode === 'new' && <BomForm products={products} t={t} onSave={saveBom} onCancel={() => setMode(null)} />}

          {current && mode !== 'new' && (
            <>
              <button type="button" className="lg:hidden text-[13px] text-blue-700" onClick={() => select(null)}>{t('boms.back')}</button>
              {mode === 'edit' ? (
                <BomForm products={products} initial={current} t={t} onSave={saveBom} onCancel={() => setMode(null)} />
              ) : (
                <div className="glass rounded-2xl p-4 flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-[#0b2a55]">{current.name}</h2>
                    <div className="text-[13px] text-slate-500">{t('boms.product')}: {productName[current.product_id] || t('boms.no_product')}</div>
                    {current.notes && <div className="text-[13px] text-slate-600 mt-1">{current.notes}</div>}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" onClick={() => setMode('edit')}><Pencil size={14} />{t('boms.edit')}</Button>
                    <Button variant="danger" onClick={deleteBom}><Trash2 size={14} />{t('boms.delete')}</Button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Stat label={t('boms.unit_total')} value={`${fmt(total, 2)} EGP`} tone="blue" />
                <div className="glass rounded-2xl px-4 py-3">
                  <label className="text-[12px] text-slate-500" htmlFor="bom-units">{t('boms.units')}</label>
                  <input id="bom-units" className="input w-full px-2 h-9 mt-1 text-[15px] font-semibold outline-none" dir="ltr" type="number" min="0" value={units} onChange={(e) => setUnits(e.target.value)} />
                </div>
                <Stat label={t('boms.order_total', { n: fmt(n) })} value={`${fmt(total * n, 2)} EGP`} tone="green" />
              </div>

              <div className="glass rounded-2xl p-3 sm:p-4">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-[13px]">
                    <thead>
                      <tr className="text-[12px] text-slate-500">
                        <th className="text-start font-medium pb-1.5">{t('boms.component')}</th>
                        <th className="text-start font-medium pb-1.5">{t('boms.qty')}</th>
                        <th className="text-start font-medium pb-1.5">{t('boms.unit_cost')}</th>
                        <th className="text-end font-medium pb-1.5 pe-2">{t('boms.line_total')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => <LineRow key={l.id} line={l} t={t} onChange={updateLine} onDelete={deleteLine} />)}
                      <tr className="border-t border-slate-200/70 bg-blue-50/40">
                        <td className="py-1.5 pe-2"><input className={cellInput} placeholder={t('boms.new_component')} value={newLine.component_name} onChange={(e) => setNewLine({ ...newLine, component_name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addLine()} /></td>
                        <td className="py-1.5 pe-2"><input className={cellInput} dir="ltr" type="number" min="0" step="any" value={newLine.quantity} onChange={(e) => setNewLine({ ...newLine, quantity: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addLine()} /></td>
                        <td className="py-1.5 pe-2"><input className={cellInput} dir="ltr" type="number" min="0" step="any" placeholder="0" value={newLine.unit_cost} onChange={(e) => setNewLine({ ...newLine, unit_cost: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addLine()} /></td>
                        <td className="py-1.5 pe-2 text-end text-slate-500 tabular-nums" dir="ltr">{fmt(lineTotal(newLine), 2)}</td>
                        <td className="py-1.5 text-end"><button type="button" onClick={addLine} className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-100" title={t('boms.add_line')} aria-label={t('boms.add_line')}><Plus size={16} /></button></td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-300">
                        <td colSpan={3} className="pt-2 font-semibold text-slate-700">{t('boms.unit_total')}</td>
                        <td className="pt-2 pe-2 text-end font-bold text-blue-700 tabular-nums" dir="ltr">{fmt(total, 2)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="text-[11.5px] text-slate-500 mt-2">{t('boms.edit_hint')}</p>
              </div>
            </>
          )}

          {!current && mode !== 'new' && boms.length > 0 && (
            <div className="hidden lg:block glass rounded-2xl p-8 text-center text-[13px] text-slate-500">{t('boms.pick')}</div>
          )}
          {!current && mode !== 'new' && boms.length === 0 && (
            <div className="glass rounded-2xl p-8 text-center text-[13px] text-slate-500">
              {t('boms.empty_hint')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
