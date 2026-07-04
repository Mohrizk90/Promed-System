// Compliance module URL helpers — keep tab navigation in sync with the router
// so browser Back stays inside Compliance instead of jumping to the ERP home.

export const COMPLIANCE_TABS = [
  'dashboard',
  'items',
  'documents',
  'processing',
  'calendar',
  'authorities',
]

export function complianceTabPath(tab) {
  const key = tab || 'dashboard'
  if (key === 'dashboard') return '/compliance'
  return `/compliance/${key}`
}

export function parseComplianceTab(tabParam) {
  if (!tabParam) return 'dashboard'
  return COMPLIANCE_TABS.includes(tabParam) ? tabParam : 'dashboard'
}

export function isCompliancePath(pathname = '') {
  return pathname === '/compliance' || pathname.startsWith('/compliance/')
}
