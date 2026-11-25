import { runExtraction } from './index.js'
import { toAdvancePayload } from './normalize.js'
import { authenticateRequest, downloadDocumentBytes, HttpError, loadDocumentForUser } from '../auth.js'
import { createUsageLog, supabaseSaver } from '../agent/usage.js'

const MAX_BYTES = Number(process.env.EXTRACTION_MAX_BYTES || 15 * 1024 * 1024)

export async function extractDocumentForUser({ documentId, user, outputLocale, onUsage }) {
  const doc = await loadDocumentForUser(documentId, user)

  if (doc.size_bytes && doc.size_bytes > MAX_BYTES) {
    throw new HttpError(413, `File too large for extraction (${doc.size_bytes} bytes, max ${MAX_BYTES})`)
  }

  const buffer = await downloadDocumentBytes(doc)
  if (buffer.length > MAX_BYTES) {
    throw new HttpError(413, `File too large for extraction (${buffer.length} bytes, max ${MAX_BYTES})`)
  }

  const extraction = await runExtraction({
    buffer,
    mimeType: doc.mime_type,
    fileName: doc.file_name,
    outputLocale,
    onUsage,
  })

  const payload = toAdvancePayload(extraction)

  return {
    documentId: doc.id,
    provider: process.env.EXTRACTION_PROVIDER || 'gemini',
    ...payload,
  }
}

export async function handleExtractRequest(req) {
  const { user, userClient } = await authenticateRequest(req)
  const usage = createUsageLog({ save: supabaseSaver(userClient) })
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const documentId = body.documentId ?? body.document_id
  const outputLocale = body.outputLocale ?? body.output_locale ?? body.locale ?? 'en'
  try {
    return await extractDocumentForUser({ documentId, user, outputLocale, onUsage: usage.report })
  } finally {
    await usage.flush()
  }
}

export { HttpError }
