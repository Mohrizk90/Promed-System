// Pure helpers for the Compliance Document Intelligence layer.
// Mirrors src/utils/complianceStatus.js shape.

// Pipeline states (10). Order matters for "next step" computation.
export const PROCESSING_STATES = [
  'uploaded',
  'queued',
  'ocr_processing',
  'text_extracted',
  'classified',
  'metadata_extracted',
  'waiting_for_review',
  'approved',
  'stored',
  'failed',
]

export const REVIEW_STATES = ['pending', 'approved', 'rejected', 'edited']

export const PROCESSING_COLORS = {
  uploaded:           { bg: 'bg-gray-100',  text: 'text-gray-700' },
  queued:             { bg: 'bg-blue-100',  text: 'text-blue-700' },
  ocr_processing:     { bg: 'bg-indigo-100',text: 'text-indigo-700' },
  text_extracted:     { bg: 'bg-violet-100',text: 'text-violet-700' },
  classified:         { bg: 'bg-fuchsia-100',text: 'text-fuchsia-700' },
  metadata_extracted: { bg: 'bg-pink-100',  text: 'text-pink-700' },
  waiting_for_review: { bg: 'bg-amber-100', text: 'text-amber-800' },
  approved:           { bg: 'bg-green-100', text: 'text-green-800' },
  stored:             { bg: 'bg-emerald-100',text: 'text-emerald-800' },
  failed:             { bg: 'bg-red-100',   text: 'text-red-700' },
}

export const REVIEW_COLORS = {
  pending:  { bg: 'bg-amber-100',  text: 'text-amber-800' },
  approved: { bg: 'bg-green-100',  text: 'text-green-800' },
  rejected: { bg: 'bg-red-100',    text: 'text-red-700' },
  edited:   { bg: 'bg-blue-100',   text: 'text-blue-700' },
}

// Polymorphic link types. entity_id references the table named by entity_type.
export const LINK_ENTITY_TYPES = [
  'compliance_item',
  'authority',
  'product',
  'supplier',
  'machine',
  'employee',
]

// Common metadata fields the review screen surfaces.
// Pipeline populates these; user can override.
export const METADATA_FIELDS = [
  { key: 'title',              labelKey: 'compliance.review.field_title' },
  { key: 'authority_name',     labelKey: 'compliance.review.field_authority' },
  { key: 'document_type',      labelKey: 'compliance.review.field_document_type' },
  { key: 'certificate_number', labelKey: 'compliance.review.field_certificate_number' },
  { key: 'reference_number',   labelKey: 'compliance.review.field_reference_number' },
  { key: 'issue_date',         labelKey: 'compliance.review.field_issue_date' },
  { key: 'expiry_date',        labelKey: 'compliance.review.field_expiry_date' },
  { key: 'renewal_period_days',labelKey: 'compliance.review.field_renewal_period' },
  { key: 'organization',       labelKey: 'compliance.review.field_organization' },
  { key: 'device_name',        labelKey: 'compliance.review.field_device_name' },
  { key: 'amount',             labelKey: 'compliance.review.field_amount' },
  { key: 'inspector',          labelKey: 'compliance.review.field_inspector' },
  { key: 'auditor',            labelKey: 'compliance.review.field_auditor' },
  { key: 'issuer',             labelKey: 'compliance.review.field_issuer' },
]

export function processingColor(status) {
  return PROCESSING_COLORS[status] || PROCESSING_COLORS.uploaded
}

export function reviewColor(status) {
  return REVIEW_COLORS[status] || REVIEW_COLORS.pending
}

// Map a 0–1 confidence to a UI bucket.
export function confidenceBucket(score) {
  if (score == null) return 'none'
  if (score >= 0.9) return 'high'
  if (score >= 0.7) return 'medium'
  return 'low'
}

export function confidenceColor(score) {
  const b = confidenceBucket(score)
  return {
    high:   { bg: 'bg-green-100',  text: 'text-green-800' },
    medium: { bg: 'bg-amber-100',  text: 'text-amber-800' },
    low:    { bg: 'bg-red-100',    text: 'text-red-700' },
    none:   { bg: 'bg-gray-100',   text: 'text-gray-600' },
  }[b]
}

export function formatConfidence(score) {
  if (score == null) return '—'
  return `${Math.round(score * 1000) / 10}%`
}

// Average confidence across an array of docs, ignoring nulls.
export function averageConfidence(docs) {
  const xs = (docs || []).map((d) => Number(d.confidence_score)).filter((n) => !isNaN(n))
  if (xs.length === 0) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

// Return docs grouped by their status; convenience for dashboards.
export function bucketByStatus(docs) {
  const out = {}
  for (const st of PROCESSING_STATES) out[st] = 0
  for (const d of docs || []) {
    const s = d.processing_status || 'uploaded'
    out[s] = (out[s] || 0) + 1
  }
  return out
}

// Average processing time in seconds for docs that reached a terminal state.
export function averageProcessingSeconds(docs) {
  const xs = (docs || [])
    .filter((d) => d.processing_started_at && d.processing_completed_at)
    .map((d) => (new Date(d.processing_completed_at).getTime() - new Date(d.processing_started_at).getTime()) / 1000)
  if (xs.length === 0) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}