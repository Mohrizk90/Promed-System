import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getComplianceHomePath, isComplianceOnlyUser } from '../utils/userAccess'
import { prefersComplianceMobile } from '../utils/deviceProfile'

/** Blocks ERP routes for compliance-only accounts. */
export default function ComplianceOnlyGuard({ children }) {
  const { user } = useAuth()
  const location = useLocation()

  if (isComplianceOnlyUser(user)) {
    const mobile = prefersComplianceMobile()
    return <Navigate to={getComplianceHomePath({ mobile })} state={{ from: location }} replace />
  }

  return children
}
