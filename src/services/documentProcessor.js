// Client for the server-side document extraction API.
// The browser never calls Gemini directly — only POST /api/compliance/extract.

const EXTRACTABLE_STATES = new Set([
  'uploaded',
  'queued',
  'ocr_processing',
  'text_extracted',
  'classified',
  'metadata_extracted',
])

export function isExtractableStatus(status) {
  return EXTRACTABLE_STATES.has(status || 'uploaded')
}

// AI providers currently understand PDF and images. Other types (docx, xlsx,
// csv, txt) skip extraction and go straight to manual review.
const AI_SUPPORTED_MIME = /^(application\/pdf|image\/(png|jpe?g|webp|gif))$/i

export function isAiSupportedMime(mimeType) {
  if (!mimeType) return false
  return AI_SUPPORTED_MIME.test(mimeType) || mimeType.toLowerCase().startsWith('image/')
}

function getApiBase() {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) {
    return String(import.meta.env.VITE_API_BASE).replace(/\/$/, '')
  }
  return ''
}

async function readError(res) {
  // Try JSON first (our API returns { error }). Fall back to raw text so that
  // platform-level failures (timeouts, crashes) surface something meaningful
  // instead of a bare "HTTP 500".
  let raw = ''
  try {
    raw = await res.text()
  } catch {
    return res.statusText || `HTTP ${res.status}`
  }
  if (raw) {
    try {
      const data = JSON.parse(raw)
      if (data?.error || data?.message) return data.error || data.message
    } catch {
      // not JSON — use a trimmed snippet of the body
    }
    const snippet = raw.replace(/\s+/g, ' ').trim().slice(0, 300)
    if (snippet) return `HTTP ${res.status}: ${snippet}`
  }
  if (res.status === 504 || res.status === 500) {
    return `HTTP ${res.status}: extraction timed out or the server crashed. Check the API function logs and GEMINI_API_KEY / SUPABASE_SERVICE_ROLE_KEY env vars.`
  }
  return res.statusText || `HTTP ${res.status}`
}

/**
 * Call backend extraction for one document.
 * Returns payload shaped for advance_document_processing RPC.
 */
export async function extractDocument(documentId, accessToken) {
  if (!documentId) throw new Error('documentId is required')
  if (!accessToken) throw new Error('Sign in required for document extraction')

  const res = await fetch(`${getApiBase()}/api/compliance/extract`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ documentId }),
  })

  if (!res.ok) {
    throw new Error(await readError(res))
  }

  const data = await res.json()
  return {
    nextStatus: data.nextStatus || 'waiting_for_review',
    extractedText: data.extractedText ?? null,
    extractedMetadata: data.extractedMetadata ?? null,
    aiSummary: data.aiSummary ?? null,
    documentType: data.documentType ?? null,
    language: data.language ?? null,
    confidenceScore: data.confidenceScore ?? null,
  }
}

// Legacy exports kept so imports do not break during transition.
export async function processStep() {
  return null
}

export async function finalizeForReview() {
  return null
}
