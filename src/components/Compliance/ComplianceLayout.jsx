// Layout for every /compliance/* route. Mounts the background AI extraction
// worker ONCE here (instead of only inside ComplianceApp) so uploads and
// reviews are processed no matter which compliance page the user is on
// (import, item detail, orphan review, or the tabbed shell).
import { Outlet } from 'react-router-dom'
import { useLanguage } from '../../context/LanguageContext'
import { useDocumentWorker } from '../../hooks/useDocumentWorker'
import { ComplianceWorkerContext } from './ComplianceWorkerContext'

export default function ComplianceLayout() {
  const { language } = useLanguage()
  const worker = useDocumentWorker({ enabled: true, outputLocale: language })
  return (
    <ComplianceWorkerContext.Provider value={worker}>
      <Outlet />
    </ComplianceWorkerContext.Provider>
  )
}
