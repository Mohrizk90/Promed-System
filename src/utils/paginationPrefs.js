const STORAGE_KEY = 'promed_pagination'

/**
 * Get stored pagination for a route (used when URL has no params, e.g. after nav link).
 * @param {string} routeKey - e.g. 'clientTransactions', 'supplierTransactions', 'entities', 'dashboard'
 * @returns {{ page: number, pageSize: number } | null}
 */
export function getPaginationPrefs(routeKey) {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}_${routeKey}`)
    if (!raw) return null
    const data = JSON.parse(raw)
    const page = Math.max(1, parseInt(data.page, 10) || 1)
    const pageSize = Math.max(1, parseInt(data.pageSize, 10) || 5)
    return { page, pageSize }
  } catch {
    return null
  }
}

/**
 * Store pagination for a route (so it survives navigation without URL params).
 * @param {string} routeKey
 * @param {{ page: number, pageSize: number }} prefs
 */
export function setPaginationPrefs(routeKey, prefs) {
  try {
    localStorage.setItem(`${STORAGE_KEY}_${routeKey}`, JSON.stringify({
      page: prefs.page,
      pageSize: prefs.pageSize,
    }))
  } catch {
    // ignore
  }
}
