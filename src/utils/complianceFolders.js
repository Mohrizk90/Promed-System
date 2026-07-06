// Folder grouping helpers for Compliance Items + Documents views.

export const FOLDER_OTHER = '__other__'
export const FOLDER_UNFILED = '__unfiled__'

const PALETTE = [
  { bg: 'bg-rose-50', border: 'border-rose-200', icon: 'text-rose-600', badge: 'bg-rose-100 text-rose-800' },
  { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'text-blue-600', badge: 'bg-blue-100 text-blue-800' },
  { bg: 'bg-amber-50', border: 'border-amber-200', icon: 'text-amber-600', badge: 'bg-amber-100 text-amber-800' },
  { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: 'text-emerald-600', badge: 'bg-emerald-100 text-emerald-800' },
  { bg: 'bg-violet-50', border: 'border-violet-200', icon: 'text-violet-600', badge: 'bg-violet-100 text-violet-800' },
  { bg: 'bg-cyan-50', border: 'border-cyan-200', icon: 'text-cyan-600', badge: 'bg-cyan-100 text-cyan-800' },
  { bg: 'bg-orange-50', border: 'border-orange-200', icon: 'text-orange-600', badge: 'bg-orange-100 text-orange-800' },
  { bg: 'bg-indigo-50', border: 'border-indigo-200', icon: 'text-indigo-600', badge: 'bg-indigo-100 text-indigo-800' },
]

export function folderPalette(index) {
  return PALETTE[index % PALETTE.length]
}

export function itemFolderKey(item) {
  return item?.compliance_categories?.name
    || item?.compliance_categories?.key
    || FOLDER_OTHER
}

export function documentFolderKey(doc) {
  if (doc?.item_id == null) return FOLDER_UNFILED
  return doc?.compliance_items?.compliance_categories?.name
    || doc?.compliance_items?.compliance_categories?.key
    || doc?.document_type
    || FOLDER_OTHER
}

export function resolveFolderLabel(key, t) {
  if (key === FOLDER_OTHER) return t('compliance.folders.other')
  if (key === FOLDER_UNFILED) return t('compliance.folders.unfiled')
  if (!key) return t('compliance.folders.other')
  const typeKey = `compliance.folders.type_${String(key).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
  const translated = t(typeKey)
  return translated !== typeKey ? translated : key
}

export function groupIntoFolders(items, getKey) {
  const map = new Map()
  for (const item of items) {
    const key = getKey(item) || FOLDER_OTHER
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(item)
  }
  return Array.from(map.entries())
    .map(([key, list]) => ({ key, count: list.length, items: list }))
    .sort((a, b) => {
      if (a.key === FOLDER_UNFILED) return -1
      if (b.key === FOLDER_UNFILED) return 1
      if (a.key === FOLDER_OTHER) return 1
      if (b.key === FOLDER_OTHER) return -1
      return b.count - a.count || String(a.key).localeCompare(String(b.key))
    })
}

export const VIEW_MODE_KEY_ITEMS = 'compliance_items_view'
export const VIEW_MODE_KEY_DOCS = 'compliance_documents_view'

export function loadViewMode(storageKey, fallback = 'folders') {
  try {
    const v = localStorage.getItem(storageKey)
    return v === 'table' ? 'table' : fallback
  } catch {
    return fallback
  }
}

export function saveViewMode(storageKey, mode) {
  try { localStorage.setItem(storageKey, mode) } catch { /* ignore */ }
}
