import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { isMobileCompliancePath, prefersComplianceMobile } from '../../utils/deviceProfile'
import { useAuth } from '../../context/AuthContext'

/** Sends phone users from full /compliance/* to the scan mini-app /m/compliance/*. */
export default function ComplianceMobileRedirect() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (!user) return
    if (!prefersComplianceMobile()) return
    if (isMobileCompliancePath(location.pathname)) return
    if (!location.pathname.startsWith('/compliance')) return

    const suffix = location.pathname.replace(/^\/compliance/, '') || ''
    const target = `/m/compliance${suffix}${location.search}`
    if (target !== `${location.pathname}${location.search}`) {
      navigate(target, { replace: true })
    }
  }, [user, location.pathname, location.search, navigate])

  // Compliance-only users on ERP are handled by ComplianceOnlyGuard.
  return null
}
