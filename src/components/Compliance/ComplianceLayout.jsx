// Layout for every /compliance/* route. Mounts the background AI extraction
// worker ONCE here (instead of only inside ComplianceApp) so uploads and
// reviews are processed no matter which compliance page the user is on
// (import, item detail, orphan review, or the tabbed shell).
import { Outlet } from 'react-router-dom'
import { useDocumentWorker } from '../../hooks/useDocumentWorker'
import { ComplianceWorkerContext } from './ComplianceWorkerContext'

export default function ComplianceLayout() {
  const worker = useDocumentWorker({ enabled: true })
  return (
    <ComplianceWorkerContext.Provider value={worker}>
      <Outlet />
    </ComplianceWorkerContext.Provider>
  )
}
