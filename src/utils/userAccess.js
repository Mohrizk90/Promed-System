// App access roles — compliance-only users see Compliance (or mobile scan) only.
// Set in Supabase: Authentication → Users → user → app_metadata: { "role": "compliance_only" }
// Or user_metadata.role. Optional dev override: VITE_COMPLIANCE_ONLY_EMAILS in .env

export const APP_ROLES = {
  FULL: 'full',
  COMPLIANCE_ONLY: 'compliance_only',
}

export function getUserAppRole(user) {
  if (!user) return APP_ROLES.FULL

  const fromMeta = user.app_metadata?.role || user.user_metadata?.role
  if (fromMeta === 'compliance_only' || fromMeta === 'compliance') {
    return APP_ROLES.COMPLIANCE_ONLY
  }

  const raw = import.meta.env.VITE_COMPLIANCE_ONLY_EMAILS || ''
  const allowlist = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (allowlist.length && user.email && allowlist.includes(user.email.toLowerCase())) {
    return APP_ROLES.COMPLIANCE_ONLY
  }

  return APP_ROLES.FULL
}

export function isComplianceOnlyUser(user) {
  return getUserAppRole(user) === APP_ROLES.COMPLIANCE_ONLY
}

export function getComplianceHomePath({ mobile = false } = {}) {
  return mobile ? '/m/compliance' : '/compliance'
}

export function getPostLoginPath(user, { mobile = false } = {}) {
  if (isComplianceOnlyUser(user)) {
    return getComplianceHomePath({ mobile })
  }
  return '/dashboard'
}

export function isErpPath(pathname = '') {
  if (!pathname || pathname === '/login' || pathname === '/signup') return false
  if (pathname.startsWith('/compliance') || pathname.startsWith('/m/compliance')) return false
  return true
}
