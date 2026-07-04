import { GoogleGenerativeAI } from '@google/generative-ai'
import { EXTRACTION_JSON_SCHEMA_DESCRIPTION, parseJsonFromModel, validateExtractionResult } from './schema.js'
import { withRetry, withTimeout, isRetryableGeminiError } from './retry.js'

const SUPPORTED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
])

const EXTRACTION_PROMPT = `
You are a compliance document intelligence engine for a medical / regulatory ERP.
Analyze the attached document (PDF or image, possibly scanned) and extract structured metadata.

Rules:
- Respond with ONLY valid JSON. No markdown, no code fences, no commentary.
- Use null for unknown scalar fields.
- Use empty arrays [] when none found for array fields.
- Dates must be ISO YYYY-MM-DD when possible.
- confidence and extraction_confidence must be numbers between 0 and 1.
- extracted_text should contain the full readable text you can recover from the document.
- summary should be a concise 2-4 sentence human-readable summary.
- document_type examples: certificate, license, inspection_report, invoice, letter, scan, spreadsheet, other.
- language: ISO 639-1 code when detectable (e.g. en, ar).

${EXTRACTION_JSON_SCHEMA_DESCRIPTION}
`.trim()

function getModelName() {
  return process.env.GEMINI_MODEL || process.env.EXTRACTION_MODEL || 'gemini-2.0-flash'
}

function getApiKey() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not configured on the server')
  return key
}

function getTimeoutMs() {
  const n = Number(process.env.EXTRACTION_TIMEOUT_MS || 55000)
  return Number.isFinite(n) ? n : 55000
}

export function isSupportedMime(mimeType) {
  if (!mimeType) return false
  const m = mimeType.toLowerCase()
  if (SUPPORTED_MIME.has(m)) return true
  return m.startsWith('image/')
}

export async function extractWithGemini({ buffer, mimeType, fileName }) {
  if (!buffer?.length) throw new Error('Empty document buffer')
  if (!isSupportedMime(mimeType)) {
    throw new Error(`Unsupported MIME type for AI extraction: ${mimeType || 'unknown'}. Supported: PDF, JPG, PNG.`)
  }

  const apiKey = getApiKey()
  const modelName = getModelName()
  const timeoutMs = getTimeoutMs()

  const run = async () => {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    })

    const base64 = Buffer.from(buffer).toString('base64')
    const result = await withTimeout(
      model.generateContent([
        { text: EXTRACTION_PROMPT },
        {
          inlineData: {
            mimeType: mimeType.toLowerCase(),
            data: base64,
          },
        },
        { text: `File name hint: ${fileName || 'document'}` },
      ]),
      timeoutMs,
      'Gemini extraction',
    )

    const text = result?.response?.text?.()
    const parsed = parseJsonFromModel(text)
    return validateExtractionResult(parsed)
  }

  return withRetry(run, {
    attempts: Number(process.env.EXTRACTION_MAX_RETRIES || 3),
    label: 'Gemini extraction',
    shouldRetry: isRetryableGeminiError,
  })
}

export const geminiProvider = {
  name: 'gemini',
  extract: extractWithGemini,
  isSupportedMime,
}
