// Dashboard tab. Aggregates metrics across items, expenses and events.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../context/LanguageContext'
import LoadingSpinner from '../LoadingSpinner'
import EmptyState from '../ui/EmptyState'
import { useComplianceItems } from './useComplianceItems'
import { computeStatus, daysUntil, bucketDueSoon, formatRemaining } from '../../utils/complianceStatus'

function ym(year, month) { return `${year}-${String(month + 1).padStart(2, '0')}` }

export default function ComplianceDashboard() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { items, loading } = useComplianceItems()
  const [expenses, setExpenses] = useState([])
  const [events, setEvents] = useState([])

  useEffect(() => {
    let mounted = true
    const loadExtras = async () => {
      const [{ data: exp }, { data: ev }] = await Promise.all([
        supabase.from('compliance_item_expenses').select('amount, expense_date'),
        supabase
          .from('compliance_item_events')
          .select('id, item_id, event_type, actor_email, payload, created_at, compliance_items:item_id (id, title)')
          .order('created_at', { ascending: false })
          .limit(10),
      ])
      if (!mounted) return
      setExpenses(exp || [])
      setEvents(ev || [])
    }
    loadExtras()
    return () => { mounted = false }
  }, [])

  const summary = useMemo(() => {
    const total = items.length
    const active = items.filter((it) => computeStatus(it) === 'active').length
    const expired = items.filter((it) => computeStatus(it) === 'expired').length
    const pendingRenewal = items.filter((it) => computeStatus(it) === 'pending_renewal').length
    const critical = items.filter((it) => it.priority === 'critical').length
    const dueBuckets = bucketDueSoon(items, [30, 14, 7, 3])

    const now = new Date()
    const monthKey = ym(now.getFullYear(), now.getMonth())
    const yearKey = String(now.getFullYear())
    const monthSum = expenses
      .filter((e) => (e.expense_date || '').startsWith(monthKey))
      .reduce((s, e) => s + Number(e.amount || 0), 0)
    const yearSum = expenses
      .filter((e) => (e.expense_date || '').startsWith(yearKey))
      .reduce((s, e) => s + Number(e.amount || 0), 0)

    // "Health" — % of non-archived items that are active or pending (not expired).
    const nonArchived = items.filter((it) => it.status !== 'archived').length
    const healthy = nonArchived === 0 ? 100
      : Math.round(100 * (nonArchived - expired) / nonArchived)

    return { total, active, expired, pendingRenewal, critical, dueBuckets, monthSum, yearSum, healthy }
  }, [items, expenses])

  const upcoming = useMemo(() => {
    return items
      .map((it) => ({ ...it, remaining: daysUntil(it.expiry_date) }))
      .filter((it) => it.remaining != null && it.remaining >= 0 && it.remaining <= 30)
      .sort((a, b) => (a.remaining || 0) - (b.remaining || 0))
      .slice(0, 10)
  }, [items])

  const formatNum = (n) => (Number(n) ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  const currency = t('compliance.currency')

  if (loading) return <LoadingSpinner />

  return (
    <div className="flex flex-col space-y-3 pb-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900">{t('compliance.dashboard_health')}</h2>
        <p className="text-sm text-gray-600">{t('compliance.subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="metric-card metric-card-green">
          <p className="text-xs font-medium text-gray-600">{t('compliance.dashboard_active')}</p>
          <p className="text-2xl font-bold text-gray-900">{summary.active}</p>
        </div>
        <div className="metric-card metric-card-red">
          <p className="text-xs font-medium text-gray-600">{t('compliance.dashboard_expired')}</p>
          <p className="text-2xl font-bold text-gray-900">{summary.expired}</p>
        </div>
        <div className="metric-card metric-card-orange">
          <p className="text-xs font-medium text-gray-600">{t('compliance.dashboard_due_soon')}</p>
          <p className="text-2xl font-bold text-gray-900">{summary.dueBuckets[30]}</p>
        </div>
        <div className="metric-card metric-card-blue">
          <p className="text-xs font-medium text-gray-600">{t('compliance.dashboard_critical')}</p>
          <p className="text-2xl font-bold text-gray-900">{summary.critical}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
          <p className="text-xs font-medium text-gray-500">{t('compliance.dashboard_health')}</p>
          <p className="text-3xl font-bold text-gray-900">{summary.healthy}%</p>
          <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full ${summary.healthy >= 80 ? 'bg-green-500' : summary.healthy >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
              style={{ width: `${Math.max(0, Math.min(100, summary.healthy))}%` }}
            />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
          <p className="text-xs font-medium text-gray-500">{t('compliance.dashboard_monthly_cost')}</p>
          <p className="text-2xl font-bold text-gray-900">{currency} {formatNum(summary.monthSum)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
          <p className="text-xs font-medium text-gray-500">{t('compliance.dashboard_yearly_cost')}</p>
          <p className="text-2xl font-bold text-gray-900">{currency} {formatNum(summary.yearSum)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">{t('compliance.dashboard_upcoming')}</h3>
          {upcoming.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">{t('compliance.dashboard_no_upcoming')}</p>
          ) : (
            <ul className="space-y-1.5">
              {upcoming.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-2 text-xs py-1.5 px-2 rounded hover:bg-gray-50">
                  <button type="button" onClick={() => navigate(`/compliance/item/${it.id}`)} className="text-left rtl:text-right flex-1 min-w-0 truncate text-gray-900 font-medium hover:underline">
                    {it.title}
                  </button>
                  <span className="text-gray-500 whitespace-nowrap">{it.expiry_date}</span>
                  <span className="text-amber-700 whitespace-nowrap">{formatRemaining(it.expiry_date, t)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">{t('compliance.dashboard_recent_activity')}</h3>
          {events.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">{t('compliance.dashboard_no_recent')}</p>
          ) : (
            <ul className="space-y-1.5">
              {events.map((ev) => (
                <li key={ev.id} className="flex items-start gap-2 text-xs py-1.5 px-2 rounded hover:bg-gray-50">
                  <span className="inline px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-medium whitespace-nowrap">
                    {t(`compliance.event_${ev.event_type}`) || ev.event_type}
                  </span>
                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => ev.compliance_items?.id && navigate(`/compliance/item/${ev.compliance_items.id}`)}
                      className="text-gray-900 font-medium truncate hover:underline text-left rtl:text-right"
                    >
                      {ev.compliance_items?.title || `Item #${ev.item_id}`}
                    </button>
                    <p className="text-gray-500 text-[10px]">{new Date(ev.created_at).toLocaleString()}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {items.length === 0 && (
        <EmptyState
          icon="default"
          title={t('compliance.noItems')}
          description={t('compliance.noItemsHint')}
        />
      )}
    </div>
  )
}