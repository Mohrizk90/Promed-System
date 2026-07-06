// Compliance module URL helpers — workflow-first navigation (Inbox is home).

export const COMPLIANCE_TABS = [
  'inbox',
  'documents',
  'items',
  'calendar',
  'authorities',
  'processing',
  // Legacy aliases (redirect in ComplianceApp)
  'dashboard',
]

export function complianceTabPath(tab) {
  const key = tab || 'inbox'
  if (key === 'inbox' || key === 'dashboard') return '/compliance'
  return `/compliance/${key}`
}

export function parseComplianceTab(tabParam) {
  if (!tabParam || tabParam === 'dashboard') return 'inbox'
  if (tabParam === 'import') return 'inbox'
  return COMPLIANCE_TABS.includes(tabParam) ? tabParam : 'inbox'
}

export function isCompliancePath(pathname = '') {
  return pathname === '/compliance' || pathname.startsWith('/compliance/')
}
