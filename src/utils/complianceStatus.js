// Pure helpers for the Compliance module. Mirrors src/utils/transactionStatus.js
// shape: tiny, side-effect-free, used by every compliance page.
//
// Status semantics:
//   - 'expired'           : expiry_date is in the past (or today)
//   - 'pending_renewal'   : expiry_date is within renewal_period_days from now
//   - 'active'            : valid item with expiry_date in the future
//   - 'archived'          : user explicitly archived it (overrides derived status)

export const STATUS_KEYS = ['active', 'expired', 'pending_renewal', 'archived']

export const PRIORITY_KEYS = ['low', 'medium', 'high', 'critical']

export const STATUS_COLORS = {
  active:         { bg: 'bg-green-100',  text: 'text-green-800' },
  expired:        { bg: 'bg-red-100',    text: 'text-red-700' },
  pending_renewal:{ bg: 'bg-amber-100',  text: 'text-amber-800' },
  archived:       { bg: 'bg-gray-200',   text: 'text-gray-600' },
}

export const PRIORITY_COLORS = {
  low:      { bg: 'bg-gray-100',  text: 'text-gray-700' },
  medium:   { bg: 'bg-blue-100',  text: 'text-blue-700' },
  high:     { bg: 'bg-amber-100', text: 'text-amber-800' },
  critical: { bg: 'bg-red-100',   text: 'text-red-700' },
}

export const EXPENSE_TYPES = [
  'government_fee',
  'consultant_fee',
  'inspection_fee',
  'certification_fee',
  'travel',
  'other',
]

// Returns today as YYYY-MM-DD using local time. Matches the convention used by
// Liabilities.jsx and other pages.
export function todayIso() {
  return new Date().toISOString().split('T')[0]
}

// Whole-day diff from today to a YYYY-MM-DD date (positive if in the future).
// Returns null when the input is missing/invalid.
export function daysUntil(dateStr) {
  if (!dateStr) return null
  const target = new Date(dateStr + 'T00:00:00')
  if (isNaN(target.getTime())) return null
  const today = new Date(todayIso() + 'T00:00:00')
  const ms = target.getTime() - today.getTime()
  return Math.round(ms / (1000 * 60 * 60 * 24))
}

// Derive a status from raw dates, unless the item is explicitly archived.
export function computeStatus(item) {
  if (!item) return 'active'
  if (item.status === 'archived') return 'archived'

  const remaining = daysUntil(item.expiry_date)
  if (remaining == null) return 'active'
  if (remaining < 0) return 'expired'

  const period = Number(item.renewal_period_days || 0)
  if (period > 0 && remaining <= period) return 'pending_renewal'

  return 'active'
}

// Human-readable remaining time for table cells: "in 12 days", "5 days overdue".
// Returns null when no expiry_date is set.
export function formatRemaining(dateStr, t) {
  const remaining = daysUntil(dateStr)
  if (remaining == null) return null
  if (remaining === 0) return t('compliance.expiry.today')
  if (remaining > 0) return t('compliance.expiry.inDays', { count: remaining })
  return t('compliance.expiry.daysAgo', { count: Math.abs(remaining) })
}

// Map a raw status/priority to its color classes (consumed by UI badges).
export function statusColor(status) {
  return STATUS_COLORS[status] || STATUS_COLORS.active
}

export function priorityColor(priority) {
  return PRIORITY_COLORS[priority] || PRIORITY_COLORS.medium
}

// Convenience: a small helper that the dashboard / calendar use to bucket
// items into "due soon" buckets based on a list of threshold days.
export function bucketDueSoon(items, thresholds = [30, 14, 7, 3]) {
  const counts = {}
  thresholds.forEach((d) => { counts[d] = 0 })
  counts.expired = 0

  for (const it of items || []) {
    const remaining = daysUntil(it.expiry_date)
    if (remaining == null) continue
    if (remaining < 0) { counts.expired++; continue }
    for (const d of thresholds) {
      if (remaining <= d) { counts[d]++; break }
    }
  }
  return counts
}