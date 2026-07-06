// Mobile detection for the scan-first Compliance mini-app.

const DESKTOP_PREF_KEY = 'compliance_force_desktop'

export function isMobileUserAgent() {
  if (typeof navigator === 'undefined') return false
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
}

export function isNarrowViewport() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(max-width: 767px)').matches
}

export function isMobileComplianceDevice() {
  return isMobileUserAgent() || isNarrowViewport()
}

export function prefersComplianceMobile() {
  if (typeof localStorage === 'undefined') return isMobileComplianceDevice()
  if (localStorage.getItem(DESKTOP_PREF_KEY) === '1') return false
  return isMobileComplianceDevice()
}

export function setForceComplianceDesktop(force) {
  if (typeof localStorage === 'undefined') return
  if (force) localStorage.setItem(DESKTOP_PREF_KEY, '1')
  else localStorage.removeItem(DESKTOP_PREF_KEY)
}

export function isMobileCompliancePath(pathname = '') {
  return pathname === '/m/compliance' || pathname.startsWith('/m/compliance/')
}
