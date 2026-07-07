// App access roles — compliance-only users see Compliance (or mobile scan) only.
// Set in Supabase: Authentication → Users → user → app_metadata: { "role": "compliance_only" }
// Or user_metadata.role. Optional dev override: VITE_COMPLIANCE_ONLY_EMAILS in .env

export const APP_ROLES = {
  FULL: 'full',
  COMPLIANCE_ONLY: 'compliance_only',
}

const COMPLIANCE_ROLE_VALUES = new Set(['compliance_only', 'compliance', 'compliance-only'])

function normalizeRoleValue(value) {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

// Look for the compliance role in every place Supabase might stash it. The
// dashboard "User Metadata" box writes to user_metadata; app_metadata is only
// settable via SQL/Admin API — so we check both, plus a few common key names
// and a boolean flag, to avoid the "I set it but it still sees everything" trap.
function detectComplianceFlag(container) {
  if (!container || typeof container !== 'object') return false

  const roleCandidates = [
    container.role,
    container.app_role,
    container.appRole,
    container.user_role,
    container.access,
    container.access_level,
  ]
  if (roleCandidates.some((r) => COMPLIANCE_ROLE_VALUES.has(normalizeRoleValue(r)))) {
    return true
  }

  // Role stored as an array, e.g. { roles: ['compliance_only'] }
  const roleArrays = [container.roles, container.role_list]
  for (const arr of roleArrays) {
    if (Array.isArray(arr) && arr.some((r) => COMPLIANCE_ROLE_VALUES.has(normalizeRoleValue(r)))) {
      return true
    }
  }

  // Explicit boolean flags.
  if (container.compliance_only === true || container.complianceOnly === true) return true
  if (normalizeRoleValue(container.compliance_only) === 'true') return true

  return false
}

export function getUserAppRole(user) {
  if (!user) return APP_ROLES.FULL

  const containers = [
    user.app_metadata,
    user.user_metadata,
    user.raw_app_meta_data,
    user.raw_user_meta_data,
    user, // top-level (e.g. user.role in some setups)
  ]
  if (containers.some((c) => detectComplianceFlag(c))) {
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
