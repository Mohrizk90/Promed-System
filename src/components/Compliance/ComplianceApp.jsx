// Top-level Compliance shell — workflow-first: Inbox → Documents → Items → Calendar.
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLanguage } from '../../context/LanguageContext'
import { useKeyboardShortcuts } from '../../context/KeyboardShortcutsContext'
import { complianceTabPath, parseComplianceTab } from '../../utils/complianceRoutes'
import ComplianceInbox from './ComplianceInbox'
import ComplianceItemsList from './ComplianceItemsList'
import ComplianceCalendar from './ComplianceCalendar'
import ComplianceAuthorityManager from './ComplianceAuthorityManager'
import ComplianceDocumentsLibrary from './ComplianceDocumentsLibrary'
import ComplianceDocumentProcessingDashboard from './ComplianceDocumentProcessingDashboard'
import { useComplianceWorkerStatus } from './ComplianceWorkerContext'
import Dropdown from '../ui/Dropdown'
import {
  MoreHorizontal, Activity, Shield, FolderOpen, FileText, Calendar,
} from '../ui/Icons'

const MAIN_TABS = [
  { key: 'inbox', Icon: FolderOpen },
  { key: 'documents', Icon: FileText },
  { key: 'items', Icon: Shield },
  { key: 'calendar', Icon: Calendar },
]

const MORE_TABS = ['processing', 'authorities']
const MORE_ICONS = { processing: Activity, authorities: Shield }

export default function ComplianceApp() {
  const { t } = useLanguage()
  const { registerShortcut, unregisterShortcut } = useKeyboardShortcuts()
  const navigate = useNavigate()
  const { tab: tabParam } = useParams()
  const tab = parseComplianceTab(tabParam)
  const worker = useComplianceWorkerStatus()

  useEffect(() => {
    if (tabParam && tabParam !== tab) {
      navigate(complianceTabPath(tab), { replace: true })
    }
  }, [tab, tabParam, navigate])

  const setTab = (key) => {
    navigate(complianceTabPath(key))
  }

  const tabLabel = (key) => {
    if (key === 'inbox') return t('compliance.tab_inbox')
    if (key === 'documents') return t('compliance.documentsLibrary.title')
    if (key === 'processing') return t('compliance.processingDashboard.title')
    return t(`compliance.tab_${key}`)
  }

  const moreActive = MORE_TABS.includes(tab)
  const showWorkerPill = tab !== 'inbox' && (worker.busy || worker.lastResult?.error)

  useEffect(() => {
    registerShortcut('1', () => setTab('inbox'), t('compliance.tab_inbox'))
    registerShortcut('2', () => setTab('documents'), t('compliance.documentsLibrary.title'))
    registerShortcut('3', () => setTab('items'), t('compliance.tab_items'))
    registerShortcut('4', () => setTab('calendar'), t('compliance.tab_calendar'))
  }, [registerShortcut, unregisterShortcut, t])

  return (
    <div className="flex flex-col gap-4 pb-4">
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{t('compliance.title')}</h1>
          <p className="text-sm text-gray-600 mt-0.5">{t('compliance.workflow.subtitle')}</p>
        </div>
        {showWorkerPill && (
          <p className="text-xs text-blue-700 bg-blue-50 px-3 py-1.5 rounded-full font-medium">
            {worker.busy ? t('compliance.ai.analyzing') : t('compliance.ai.hint')}
          </p>
        )}
      </header>

      <nav
        className="flex flex-wrap items-center gap-1 p-1 bg-gray-100/80 rounded-xl border border-gray-200 print:hidden"
        aria-label="Compliance sections"
      >
        {MAIN_TABS.map(({ key, Icon }) => {
          const active = tab === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all rtl-flip ${
                active
                  ? 'bg-white text-rose-700 shadow-sm ring-1 ring-rose-100'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={16} className={active ? 'text-rose-600' : 'text-gray-400'} />
              {tabLabel(key)}
            </button>
          )
        })}
        <Dropdown
          align="left"
          className="ms-auto"
          trigger={
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium ${
                moreActive ? 'bg-white text-rose-700 shadow-sm' : 'text-gray-600'
              }`}
            >
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

      <div className="flex-1 min-h-0">
        {tab === 'inbox' && <ComplianceInbox />}
        {tab === 'items' && <ComplianceItemsList />}
        {tab === 'documents' && <ComplianceDocumentsLibrary />}
        {tab === 'processing' && <ComplianceDocumentProcessingDashboard />}
        {tab === 'calendar' && <ComplianceCalendar />}
        {tab === 'authorities' && <ComplianceAuthorityManager />}
      </div>
    </div>
  )
}
