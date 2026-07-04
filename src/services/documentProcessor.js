// Document processing service — the single seam where real AI/OCR will live
// later. Today it's a deterministic stub that returns canned values based on
// the document MIME type so the UI, dashboard and review screen can be tested
// end-to-end without any external services.
//
// To wire real AI/OCR: replace `processStep` with a fetch() to your backend
// (e.g. POST /api/ocr-and-extract with the file). The rest of the pipeline
// (DB functions, UI tabs, dashboard) doesn't change.

const OCR_STATES = ['queued', 'ocr_processing', 'text_extracted', 'classified', 'metadata_extracted']

function inferDocumentType(mimeType) {
  if (!mimeType) return 'document'
  if (mimeType.includes('pdf')) return 'certificate'
  if (mimeType.startsWith('image/')) return 'scan'
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'spreadsheet'
  if (mimeType.includes('word') || mimeType.includes('doc')) return 'letter'
  return 'document'
}

function guessLanguage(mimeType, fileName) {
  const low = (fileName || '').toLowerCase()
  if (low.includes('ar') || low.includes('arabic')) return 'ar'
  if (low.includes('en') || low.includes('english')) return 'en'
  if (mimeType?.startsWith('image/')) return 'ar'
  return 'en'
}

function cannedMetadata(file) {
  return {
    authority_name: null,
    document_type: inferDocumentType(file.mime_type),
    certificate_number: null,
    reference_number: null,
    issue_date: null,
    expiry_date: null,
    renewal_period_days: null,
    organization: null,
    device_name: null,
    amount: null,
    inspector: null,
    auditor: null,
    issuer: null,
  }
}

function cannedSummary(file, metadata) {
  return `Document "${file.file_name}" was processed automatically. No values were extracted — please review and fill in the fields.`
}

// Decide the next status + what fields (if any) to populate.
// `file` shape: { id, file_name, mime_type, processing_status, extracted_text?, extracted_metadata? }
export async function processStep(file) {
  const cur = file.processing_status || 'queued'
  const i = OCR_STATES.indexOf(cur)
  if (i < 0) return null  // terminal or unexpected

  const next = OCR_STATES[i + 1]
  if (!next) return null

  // Build a partial update depending on the step.
  if (next === 'ocr_processing') {
    return { nextStatus: next }
  }
  if (next === 'text_extracted') {
    return {
      nextStatus: next,
      extractedText: `[stub] extracted text for ${file.file_name}`,
      language: guessLanguage(file.mime_type, file.file_name),
    }
  }
  if (next === 'classified') {
    return {
      nextStatus: next,
      documentType: inferDocumentType(file.mime_type),
      language: guessLanguage(file.mime_type, file.file_name),
    }
  }
  if (next === 'metadata_extracted') {
    return {
      nextStatus: next,
      extractedMetadata: cannedMetadata(file),
    }
  }
  return { nextStatus: next }
}

// Produce the final "wait for review" payload.
export async function finalizeForReview(file) {
  return {
    nextStatus: 'waiting_for_review',
    confidenceScore: 0.5,                                  // stub: half-confident
    aiSummary: cannedSummary(file, cannedMetadata(file)),
    documentType: inferDocumentType(file.mime_type),
    language: guessLanguage(file.mime_type, file.file_name),
    extractedMetadata: cannedMetadata(file),
    extractedText: `[stub] extracted text for ${file.file_name}`,
  }
}
