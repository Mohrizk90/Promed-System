// JSON shape returned by AI providers — maps to compliance_item_documents fields.

export const EXTRACTION_JSON_SCHEMA_DESCRIPTION = `
Return a single JSON object with exactly these keys (use null when unknown):
{
  "title": string | null,
  "document_type": string | null,
  "authority_name": string | null,
  "reference_number": string | null,
  "certificate_number": string | null,
  "issue_date": "YYYY-MM-DD" | null,
  "expiry_date": "YYYY-MM-DD" | null,
  "renewal_period_days": number | null,
  "language": string | null,
  "summary": string | null,
  "extracted_text": string | null,
  "confidence": number,
  "extraction_confidence": number,
  "tags": string[],
  "important_notes": string[],
  "missing_fields": string[],
  "warnings": string[],
  "organization": string | null,
  "device_name": string | null,
  "amount": number | null,
  "inspector": string | null,
  "auditor": string | null,
  "issuer": string | null,
  "products": string[],
  "supplier": string | null,
  "machine": string | null,
  "employee": string | null
}
`.trim()

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function asString(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s.length ? s : null
}

function asStringArray(v) {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x).trim()).filter(Boolean)
}

function asNumber(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function asConfidence(v, fallback = 0.5) {
  const n = asNumber(v)
  if (n == null) return fallback
  if (n > 1 && n <= 100) return Math.min(1, n / 100)
  return Math.max(0, Math.min(1, n))
}

function asDate(v) {
  const s = asString(v)
  if (!s) return null
  if (DATE_RE.test(s)) return s
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

/** Strip accidental markdown fences from model output. */
export function parseJsonFromModel(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Model returned empty response')
  }
  let raw = text.trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) raw = fenced[1].trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error('Model response did not contain JSON object')
  }
  return JSON.parse(raw.slice(start, end + 1))
}

/** Validate + normalize provider output into a stable internal shape. */
export function validateExtractionResult(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Extraction result must be a JSON object')
  }

  const confidence = asConfidence(raw.confidence, asConfidence(raw.extraction_confidence, 0.5))
  const extractionConfidence = asConfidence(raw.extraction_confidence, confidence)

  return {
    title: asString(raw.title),
    document_type: asString(raw.document_type),
    authority_name: asString(raw.authority_name),
    reference_number: asString(raw.reference_number),
    certificate_number: asString(raw.certificate_number),
    issue_date: asDate(raw.issue_date),
    expiry_date: asDate(raw.expiry_date),
    renewal_period_days: asNumber(raw.renewal_period_days),
    language: asString(raw.language),
    summary: asString(raw.summary),
    extracted_text: asString(raw.extracted_text),
    confidence,
    extraction_confidence: extractionConfidence,
    tags: asStringArray(raw.tags),
    important_notes: asStringArray(raw.important_notes),
    missing_fields: asStringArray(raw.missing_fields),
    warnings: asStringArray(raw.warnings),
    organization: asString(raw.organization),
    device_name: asString(raw.device_name),
    amount: asNumber(raw.amount),
    inspector: asString(raw.inspector),
    auditor: asString(raw.auditor),
    issuer: asString(raw.issuer),
    products: asStringArray(raw.products),
    supplier: asString(raw.supplier),
    machine: asString(raw.machine),
    employee: asString(raw.employee),
  }
}
