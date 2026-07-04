// Top-level Compliance module page: tab shell + sub-views.
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLanguage } from '../../context/LanguageContext'
import { useKeyboardShortcuts } from '../../context/KeyboardShortcutsContext'
import { complianceTabPath, parseComplianceTab } from '../../utils/complianceRoutes'
import ComplianceDashboard from './ComplianceDashboard'
import ComplianceItemsList from './ComplianceItemsList'
import ComplianceCalendar from './ComplianceCalendar'
import ComplianceAuthorityManager from './ComplianceAuthorityManager'
import ComplianceDocumentsLibrary from './ComplianceDocumentsLibrary'
import ComplianceDocumentProcessingDashboard from './ComplianceDocumentProcessingDashboard'
import AiWorkerStatus from './AiWorkerStatus'
import { useComplianceWorkerStatus } from './ComplianceWorkerContext'
import Dropdown from '../ui/Dropdown'
import { MoreHorizontal, Activity, Shield } from '../ui/Icons'

// Primary tabs stay inline; less-frequent views live under a "More" menu to
// reduce clutter and make the module feel focused.
const CORE_TABS = ['dashboard', 'items', 'documents', 'calendar']
const MORE_TABS = ['processing', 'authorities']
const MORE_ICONS = { processing: Activity, authorities: Shield }

export default function ComplianceApp() {
  const { t } = useLanguage()
  const { registerShortcut, unregisterShortcut } = useKeyboardShortcuts()
  const navigate = useNavigate()
  const { tab: tabParam } = useParams()
  const tab = parseComplianceTab(tabParam)

  // Background AI extraction worker is mounted by ComplianceLayout; read status.
  const worker = useComplianceWorkerStatus()

  useEffect(() => {
    if (tabParam && tabParam !== tab) {
      navigate(complianceTabPath(tab), { replace: true })
    }
  }, [tab, tabParam, navigate])

  const setTab = (key) => {
    navigate(complianceTabPath(key))
  }

  const tabLabel = (key) => (
    key === 'documents' ? t('compliance.documentsLibrary.title')
      : key === 'processing' ? t('compliance.processingDashboard.title')
        : t(`compliance.tab_${key}`)
  )

  const moreActive = MORE_TABS.includes(tab)
  // Show the active "More" tab inline (as active) so the user always sees where they are.
  const inlineTabs = moreActive ? [...CORE_TABS, tab] : CORE_TABS

  useEffect(() => {
    const set1 = () => setTab('dashboard')
    const set2 = () => setTab('items')
    const set3 = () => setTab('documents')
    const set4 = () => setTab('processing')
    const set5 = () => setTab('calendar')
    const set6 = () => setTab('authorities')

    registerShortcut('1', set1, t('compliance.tab_dashboard'))
    registerShortcut('2', set2, t('compliance.tab_items'))
    registerShortcut('3', set3, t('compliance.documentsLibrary.title'))
    registerShortcut('4', set4, t('compliance.processingDashboard.title'))
    registerShortcut('5', set5, t('compliance.tab_calendar'))
    registerShortcut('6', set6, t('compliance.tab_authorities'))

    return () => {
      unregisterShortcut('1'); unregisterShortcut('2'); unregisterShortcut('3')
      unregisterShortcut('4'); unregisterShortcut('5'); unregisterShortcut('6')
    }
  }, [registerShortcut, unregisterShortcut, t])

  return (
    <div className="flex flex-col space-y-3 pb-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('compliance.title')}</h1>
          <p className="text-sm text-gray-600">{t('compliance.subtitle')}</p>
        </div>
        <AiWorkerStatus busy={worker.busy} lastResult={worker.lastResult} />
      </div>

      <div className="border-b border-gray-200 print:hidden">
        <nav className="flex flex-wrap items-center gap-1 -mb-px" aria-label="Compliance tabs">
          {inlineTabs.map((key) => {
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
                {tabLabel(key)}
              </button>
            )
          })}
          <Dropdown
            align="left"
            className="ms-1"
            trigger={
              <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${moreActive ? 'text-rose-700' : 'text-gray-500'}`}>
                <MoreHorizontal size={16} /> {t('common.more')}
              </span>
            }
            items={MORE_TABS.map((key) => ({
              label: tabLabel(key),
              icon: MORE_ICONS[key],
              onClick: () => setTab(key),
            }))}
          />
        </nav>
      </div>

      <div className="flex-1 min-h-0">
        {tab === 'dashboard' && <ComplianceDashboard />}
        {tab === 'items' && <ComplianceItemsList />}
        {tab === 'documents' && <ComplianceDocumentsLibrary />}
        {tab === 'processing' && <ComplianceDocumentProcessingDashboard />}
        {tab === 'calendar' && <ComplianceCalendar />}
        {tab === 'authorities' && <ComplianceAuthorityManager />}
      </div>
    </div>
  )
}