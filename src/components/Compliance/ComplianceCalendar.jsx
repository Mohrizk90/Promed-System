// Month-grid calendar of expiry dates. Click a cell to see the day's items.
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLanguage } from '../../context/LanguageContext'
import LoadingSpinner from '../LoadingSpinner'
import { ChevronLeft, ChevronRight } from '../ui/Icons'
import { useComplianceItems } from './useComplianceItems'
import { computeStatus } from '../../utils/complianceStatus'

function pad(n) { return String(n).padStart(2, '0') }
function ymd(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}` }

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export default function ComplianceCalendar() {
  const { t, language } = useLanguage()
  const navigate = useNavigate()
  const { items, loading } = useComplianceItems()
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [selectedDay, setSelectedDay] = useState(null)

  const today = useMemo(() => new Date(), [])
  const todayStr = useMemo(() => ymd(today.getFullYear(), today.getMonth(), today.getDate()), [today])

  const grid = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const start = new Date(first)
    // Monday-first: getDay() returns 0=Sun..6=Sat; we want Mon=0
    const offset = (first.getDay() + 6) % 7
    start.setDate(first.getDate() - offset)
    const days = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      days.push(d)
    }
    return days
  }, [cursor])

  const byDay = useMemo(() => {
    const map = new Map()
    for (const it of items) {
      if (!it.expiry_date) continue
      const list = map.get(it.expiry_date) || []
      list.push(it)
      map.set(it.expiry_date, list)
    }
    return map
  }, [items])

  const monthLabel = useMemo(() => {
    return cursor.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', { month: 'long', year: 'numeric' })
  }, [cursor, language])

  const selectedItems = selectedDay ? (byDay.get(selectedDay) || []) : []

  if (loading) return <LoadingSpinner />

  return (
    <div className="flex flex-col space-y-3 pb-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{t('compliance.tab_calendar')}</h2>
          <p className="text-sm text-gray-600">{t('compliance.subtitle')}</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700" title={t('compliance.calendar_prev')} aria-label={t('compliance.calendar_prev')}>
            <ChevronLeft size={16} />
          </button>
          <div className="px-3 py-1.5 text-sm font-semibold text-gray-800 min-w-[140px] text-center">{monthLabel}</div>
          <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700" title={t('compliance.calendar_next')} aria-label={t('compliance.calendar_next')}>
            <ChevronRight size={16} />
          </button>
          <button type="button" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); setSelectedDay(ymd(d.getFullYear(), d.getMonth(), d.getDate())) }} className="ml-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-100 text-rose-700 hover:bg-rose-200">
            {t('compliance.calendar_today')}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="grid grid-cols-7 bg-gray-100 text-xs">
          {WEEKDAY_KEYS.map((k) => (
            <div key={k} className="px-2 py-2 text-center font-semibold text-gray-700 uppercase">
              {t(`compliance.weekday.${k}`)}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {grid.map((d) => {
            const inMonth = d.getMonth() === cursor.getMonth()
            const ds = ymd(d.getFullYear(), d.getMonth(), d.getDate())
            const isToday = ds === todayStr
            const isSelected = ds === selectedDay
            const dayItems = byDay.get(ds) || []
            return (
              <div
                key={ds}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                onClick={() => setSelectedDay(ds)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedDay(ds) } }}
                className={`cursor-pointer text-left rtl:text-right p-2 min-h-[88px] border-t border-r border-gray-100 last:border-r-0 transition-colors focus:outline-none focus:ring-2 focus:ring-rose-400 focus:ring-inset ${inMonth ? 'bg-white' : 'bg-gray-50 text-gray-400'} ${isSelected ? 'ring-2 ring-rose-500 ring-inset' : ''} ${isToday ? 'bg-rose-50' : 'hover:bg-gray-50'}`}
              >
                <div className={`text-xs font-semibold ${isToday ? 'text-rose-700' : ''}`}>{d.getDate()}</div>
                <ul className="mt-1 space-y-0.5">
                  {dayItems.slice(0, 3).map((it) => {
                    const s = computeStatus(it)
                    const colors = {
                      active: 'bg-green-100 text-green-800',
                      pending_renewal: 'bg-amber-100 text-amber-800',
                      expired: 'bg-red-100 text-red-700',
                      archived: 'bg-gray-100 text-gray-600',
                    }[s]
                    return (
                      <li key={it.id}>
                        <button
                          type="button"
                          className={`w-full text-left rtl:text-right text-[10px] truncate px-1 rounded ${colors}`}
                          title={it.title}
                          onClick={(e) => { e.stopPropagation(); navigate(`/compliance/item/${it.id}`) }}
                        >
                          {it.title}
                        </button>
                      </li>
                    )
                  })}
                  {dayItems.length > 3 && (
                    <li className="text-[10px] text-gray-500">{t('compliance.calendar_more', { n: dayItems.length - 3 })}</li>
                  )}
                </ul>
              </div>
            )
          })}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">
          {selectedDay || todayStr}
        </h3>
        {selectedItems.length === 0 ? (
          <p className="text-sm text-gray-500 py-3 text-center">{t('compliance.calendar_no_events')}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {selectedItems.map((it) => (
              <li key={it.id}>
                <button type="button" onClick={() => navigate(`/compliance/item/${it.id}`)} className="w-full text-left rtl:text-right py-2 px-2 rounded hover:bg-gray-50 flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900 truncate">{it.title}</span>
                  <span className="text-xs text-gray-500 whitespace-nowrap">{it.compliance_authorities?.name || ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}