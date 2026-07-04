// Top-level Compliance module page: tab shell + sub-views.
import { useEffect, useState } from 'react'
import { useLanguage } from '../../context/LanguageContext'
import { useKeyboardShortcuts } from '../../context/KeyboardShortcutsContext'
import ComplianceDashboard from './ComplianceDashboard'
import ComplianceItemsList from './ComplianceItemsList'
import ComplianceCalendar from './ComplianceCalendar'
import ComplianceAuthorityManager from './ComplianceAuthorityManager'

const TABS = ['dashboard', 'items', 'calendar', 'authorities']

export default function ComplianceApp() {
  const { t } = useLanguage()
  const { registerShortcut, unregisterShortcut } = useKeyboardShortcuts()
  const [tab, setTab] = useState('dashboard')

  // Numeric shortcuts 1..4 inside the module. Registered in an effect so the
  // action functions don't change on every render (that would re-trigger
  // setShortcuts in the provider, which re-renders, which calls us again ->
  // infinite loop and a frozen page).
  useEffect(() => {
    const set1 = () => setTab('dashboard')
    const set2 = () => setTab('items')
    const set3 = () => setTab('calendar')
    const set4 = () => setTab('authorities')

    registerShortcut('1', set1, t('compliance.tab_dashboard'))
    registerShortcut('2', set2, t('compliance.tab_items'))
    registerShortcut('3', set3, t('compliance.tab_calendar'))
    registerShortcut('4', set4, t('compliance.tab_authorities'))

    return () => {
      unregisterShortcut('1')
      unregisterShortcut('2')
      unregisterShortcut('3')
      unregisterShortcut('4')
    }
  }, [registerShortcut, unregisterShortcut, t])

  return (
    <div className="flex flex-col space-y-3 pb-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('compliance.title')}</h1>
        <p className="text-sm text-gray-600">{t('compliance.subtitle')}</p>
      </div>

      <div className="border-b border-gray-200 print:hidden">
        <nav className="flex flex-wrap gap-1 -mb-px" aria-label="Compliance tabs">
          {TABS.map((key) => {
            const active = tab === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors rtl-flip ${
                  active
                    ? 'border-rose-600 text-rose-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                {t(`compliance.tab_${key}`)}
              </button>
            )
          })}
        </nav>
      </div>

      <div className="flex-1 min-h-0">
        {tab === 'dashboard' && <ComplianceDashboard />}
        {tab === 'items' && <ComplianceItemsList />}
        {tab === 'calendar' && <ComplianceCalendar />}
        {tab === 'authorities' && <ComplianceAuthorityManager />}
      </div>
    </div>
  )
}