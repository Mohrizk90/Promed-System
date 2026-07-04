// Module-level Processing dashboard: counts of queued / OCR running /
// waiting_for_review / approved / failed, average confidence, average
// processing time, and bar charts by authority + by document type.
import { useEffect, useMemo, useState } from 'react'
import { useLanguage } from '../../context/LanguageContext'
import { supabase } from '../../lib/supabase'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  bucketByStatus, averageConfidence, averageProcessingSeconds, formatConfidence,
} from '../../utils/documentProcessing'
import LoadingSpinner from '../LoadingSpinner'

const WORKING_STATES = ['queued', 'ocr_processing', 'text_extracted', 'classified', 'metadata_extracted']

const COLOR_FOR_STATE = {
  queued:             '#60a5fa',
  ocr_processing:     '#818cf8',
  text_extracted:     '#a78bfa',
  classified:         '#d946ef',
  metadata_extracted: '#ec4899',
  waiting_for_review: '#fbbf24',
  approved:           '#34d399',
  stored:             '#10b981',
  failed:             '#f87171',
  uploaded:           '#d1d5db',
}

export default function ComplianceDocumentProcessingDashboard() {
  const { t } = useLanguage()
  const [docs, setDocs] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        const [{ data: d }, { data: it }] = await Promise.all([
          supabase
            .from('compliance_item_documents')
            .select('id, item_id, processing_status, review_status, document_type, confidence_score, processing_started_at, processing_completed_at, compliance_items:item_id ( id, authority_id, compliance_authorities:authority_id (name) )')
            .order('created_at', { ascending: false })
            .limit(500),
          supabase.from('compliance_items').select('id, authority_id, compliance_authorities:authority_id (name)'),
        ])
        setDocs(d || [])
        setItems(it || [])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const buckets = useMemo(() => bucketByStatus(docs), [docs])
  const avgConf = useMemo(() => averageConfidence(docs), [docs])
  const avgSeconds = useMemo(() => averageProcessingSeconds(docs), [docs])

  // Charts data
  const byAuthority = useMemo(() => {
    const map = new Map()
    for (const d of docs) {
      const name = d.compliance_items?.compliance_authorities?.name || '—'
      map.set(name, (map.get(name) || 0) + 1)
    }
    return Array.from(map.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10)
  }, [docs])

  const byType = useMemo(() => {
    const map = new Map()
    for (const d of docs) {
      const k = d.document_type || 'unknown'
      map.set(k, (map.get(k) || 0) + 1)
    }
    return Array.from(map.entries()).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count)
  }, [docs])

  const formatSec = (s) => {
    if (s == null) return '—'
    if (s < 60) return `${Math.round(s)} s`
    return `${Math.round(s / 60)} m`
  }

  if (loading) return <LoadingSpinner />

  const workingTotal = WORKING_STATES.reduce((sum, k) => sum + (buckets[k] || 0), 0)

  return (
    <div className="flex flex-col space-y-3 pb-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900">{t('compliance.processingDashboard.title')}</h2>
        <p className="text-sm text-gray-600">{t('compliance.processingDashboard.subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Card label={t('compliance.processingDashboard.queued')} value={workingTotal} tone="blue" />
        <Card label={t('compliance.processingDashboard.waiting_review')} value={buckets.waiting_for_review || 0} tone="amber" />
        <Card label={t('compliance.processingDashboard.approved')} value={(buckets.approved || 0) + (buckets.stored || 0)} tone="green" />
        <Card label={t('compliance.processingDashboard.failed')} value={buckets.failed || 0} tone="red" />
        <Card label={t('compliance.processingDashboard.avg_confidence')} value={formatConfidence(avgConf)} tone="indigo" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">{t('compliance.processingDashboard.by_authority')}</h3>
          {byAuthority.length === 0 ? (
            <p className="text-sm text-gray-500 py-3 text-center">{t('compliance.processingDashboard.no_data')}</p>
          ) : (
            <div className="w-full min-w-0" style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height={240} minWidth={0} debounce={50}>
                <BarChart data={byAuthority} margin={{ top: 8, right: 8, left: 0, bottom: 28 }}>
                  <CartesianGrid stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={60} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#e11d48" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">{t('compliance.processingDashboard.by_type')}</h3>
          {byType.length === 0 ? (
            <p className="text-sm text-gray-500 py-3 text-center">{t('compliance.processingDashboard.no_data')}</p>
          ) : (
            <div className="w-full min-w-0" style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height={240} minWidth={0} debounce={50}>
                <BarChart data={byType} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                  <CartesianGrid stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="type" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
        <p className="text-sm font-semibold text-gray-700">{t('compliance.processingDashboard.avg_processing_time')}</p>
        <p className="text-2xl font-bold text-gray-900">{formatSec(avgSeconds)}</p>
        <p className="text-[11px] text-gray-500">{t('compliance.processingDashboard.no_data') === 'No processed documents yet' ? 'across documents with both start and complete timestamps' : ''}</p>
      </div>
    </div>
  )
}

function Card({ label, value, tone }) {
  const tones = {
    blue:   'bg-blue-50 text-blue-900 border-blue-200',
    amber:  'bg-amber-50 text-amber-900 border-amber-200',
    green:  'bg-green-50 text-green-900 border-green-200',
    red:    'bg-red-50 text-red-900 border-red-200',
    indigo: 'bg-indigo-50 text-indigo-900 border-indigo-200',
  }
  return (
    <div className={`rounded-xl border p-3 ${tones[tone] || tones.blue}`}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  )
}