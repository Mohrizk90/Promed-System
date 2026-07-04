// Chronological activity log. Pure presentation; reads from
// compliance_item_events and renders payload metadata in a friendly format.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import { useLanguage } from '../../context/LanguageContext'
import LoadingSpinner from '../LoadingSpinner'
import { Activity, CheckCircle, FileText, RefreshCw, UserCheck, Wallet, Plus } from '../ui/Icons'

const ICON_MAP = {
  created: Plus,
  status_changed: RefreshCw,
  owner_changed: UserCheck,
  renewed: RefreshCw,
  document_uploaded: FileText,
  document_replaced: FileText,
  document_extracted: FileText,
  document_reviewed: CheckCircle,
  document_processing_failed: Activity,
  extraction_applied: RefreshCw,
  task_completed: CheckCircle,
  task_added: Plus,
  fee_paid: Wallet,
  comment: Activity,
}

function describePayload(event_type, payload, t) {
  if (!payload) return ''
  if (event_type === 'status_changed') return `${payload.from || ''} → ${payload.to || ''}`
  if (event_type === 'owner_changed') return `${payload.from || ''} → ${payload.to || ''}`
  if (event_type === 'renewed') return `${payload.from || ''} → ${payload.to || ''}`
  if (event_type === 'document_uploaded' || event_type === 'document_replaced') return payload.file_name || ''
  if (event_type === 'document_extracted') {
    const bits = [payload.file_name]
    if (payload.document_type) bits.push(payload.document_type)
    if (payload.confidence != null) bits.push(`${Math.round(payload.confidence * 100)}%`)
    return bits.join(' · ')
  }
  if (event_type === 'document_reviewed') {
    return `${payload.file_name || ''} → ${payload.review_status || ''}`.trim()
  }
  if (event_type === 'document_processing_failed') {
    const errs = (payload.errors || []).join('; ')
    return `${payload.file_name || ''}${errs ? ` — ${errs}` : ''}`
  }
  if (event_type === 'extraction_applied') {
    const applied = payload.applied
      ? Object.entries(payload.applied).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ')
      : ''
    return payload.file_name ? `${payload.file_name} → ${applied || 'link only'}` : applied
  }
  if (event_type === 'task_completed' || event_type === 'task_added') return payload.title || ''
  if (event_type === 'fee_paid') return `${payload.expense_type || ''} · ${payload.amount || ''}`
  return ''
}

export default function ComplianceItemTimeline({ itemId }) {
  const { t } = useLanguage()
  const { error: showError } = useToast()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchEvents = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('compliance_item_events')
        .select('*')
        .eq('item_id', itemId)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      setEvents(data || [])
    } catch (err) {
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!itemId) return
    fetchEvents()
    const ch = supabase
      .channel(`compliance_events_${itemId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compliance_item_events', filter: `item_id=eq.${itemId}` }, () => fetchEvents())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [itemId])

  if (loading) return <LoadingSpinner size="sm" />

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed border-gray-200 rounded">
        <p className="text-sm text-gray-500">{t('compliance.noTimeline')}</p>
      </div>
    )
  }

  return (
    <ol className="relative border-s border-gray-200 ms-3 mt-2 space-y-3">
      {events.map((ev) => {
        const Icon = ICON_MAP[ev.event_type] || Activity
        const desc = describePayload(ev.event_type, ev.payload, t)
        return (
          <li key={ev.id} className="ms-4">
            <span className="absolute -start-2 flex items-center justify-center w-5 h-5 bg-rose-100 rounded-full ring-4 ring-white">
              <Icon size={12} className="text-rose-700" />
            </span>
            <div className="flex flex-col gap-0.5 py-1">
              <p className="text-sm font-medium text-gray-900">
                {t(`compliance.event_${ev.event_type}`) || ev.event_type}
                {desc && <span className="text-gray-600 font-normal"> · {desc}</span>}
              </p>
              <p className="text-[11px] text-gray-500">
                {new Date(ev.created_at).toLocaleString()}
                {ev.actor_email ? ` · ${ev.actor_email}` : ''}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}