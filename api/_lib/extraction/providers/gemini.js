import { GoogleGenerativeAI } from '@google/generative-ai'
import { EXTRACTION_JSON_SCHEMA_DESCRIPTION, parseJsonFromModel, validateExtractionResult } from '../schema.js'
import { withRetry, withTimeout, isRetryableGeminiError } from '../retry.js'

const SUPPORTED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
])

const EXTRACTION_PROMPT_BASE = `
You are a compliance document intelligence engine for a medical / regulatory ERP.
Analyze the attached document (PDF or image, possibly scanned) and extract structured metadata.

Rules:
- Respond with ONLY valid JSON. No markdown, no code fences, no commentary.
- Use null for unknown scalar fields.
- Use empty arrays [] when none found for array fields.
- Dates must be ISO YYYY-MM-DD when possible.
- confidence and extraction_confidence must be numbers between 0 and 1.
- extracted_text should contain the full readable text you can recover from the document (preserve original script).
- summary should be a concise 2-4 sentence human-readable summary.
- document_type examples: certificate, license, inspection_report, invoice, letter, scan, spreadsheet, other.
- language: ISO 639-1 code for the document's primary language (e.g. en, ar).

${EXTRACTION_JSON_SCHEMA_DESCRIPTION}
`.trim()

function localeInstructions(outputLocale) {
  const loc = (outputLocale || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en'
  if (loc === 'ar') {
    return `
OUTPUT LOCALE: Arabic (ar)
- Write title, summary, authority_name, organization, issuer, inspector, auditor, important_notes, and all other human-readable string fields in Arabic script.
- Do NOT transliterate Arabic to English or Latin letters in output fields.
- If the document is Arabic, keep Arabic. If bilingual, prefer Arabic for output fields.
- extracted_text must keep the document's original script; never romanize Arabic names or titles.
- Set language to "ar" when the document is primarily Arabic.
`.trim()
  }
  return `
OUTPUT LOCALE: English (en)
- Write title, summary, authority_name, organization, issuer, inspector, auditor, important_notes, and all other human-readable string fields in clear English.
- Translate or transliterate Arabic (or other non-Latin) content into English for these output fields so English-speaking users can read them.
- extracted_text may include original script where helpful, but summary must be English.
- Set language to the document's primary language code (e.g. ar, en).
`.trim()
}

function buildExtractionPrompt(outputLocale) {
  return `${EXTRACTION_PROMPT_BASE}\n\n${localeInstructions(outputLocale)}`
}

function getModelName() {
  return process.env.GEMINI_MODEL || process.env.EXTRACTION_MODEL || 'gemini-2.5-flash'
}

function getApiKey() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not configured on the server')
  return key
}

// Total wall-clock budget for the WHOLE extraction (all attempts + backoff).
// Must stay safely under the serverless function maxDuration (60s) so our own
// error handler can return a JSON error instead of the platform killing the
// function and returning a bare HTTP 500.
function getTotalBudgetMs() {
  const n = Number(process.env.EXTRACTION_TIMEOUT_MS || 50000)
  return Number.isFinite(n) && n > 0 ? n : 50000
}

export function isSupportedMime(mimeType) {
  if (!mimeType) return false
  const m = mimeType.toLowerCase()
  if (SUPPORTED_MIME.has(m)) return true
  return m.startsWith('image/')
}

export async function extractWithGemini({ buffer, mimeType, fileName, outputLocale }) {
  if (!buffer?.length) throw new Error('Empty document buffer')
  if (!isSupportedMime(mimeType)) {
    throw new Error(`Unsupported MIME type for AI extraction: ${mimeType || 'unknown'}. Supported: PDF, JPG, PNG.`)
  }

  const apiKey = getApiKey()
  const modelName = getModelName()
  const deadline = Date.now() + getTotalBudgetMs()

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  })
  const base64 = Buffer.from(buffer).toString('base64')

  const run = async () => {
    const remaining = deadline - Date.now()
    if (remaining < 3000) {
      throw new Error('Gemini extraction time budget exhausted')
    }
    const result = await withTimeout(
      model.generateContent([
        { text: buildExtractionPrompt(outputLocale) },
        {
          inlineData: {
            mimeType: mimeType.toLowerCase(),
            data: base64,
          },
        },
        { text: `File name hint: ${fileName || 'document'}` },
      ]),
      remaining,
      'Gemini extraction',
    )

    const text = result?.response?.text?.()
    const parsed = parseJsonFromModel(text)
    return validateExtractionResult(parsed)
  }

  return withRetry(run, {
    attempts: Number(process.env.EXTRACTION_MAX_RETRIES || 3),
    baseDelayMs: 800,
    maxDelayMs: 3000,
    label: 'Gemini extraction',
    // Only retry when the error is retryable AND we still have time budget left.
    shouldRetry: (err) => isRetryableGeminiError(err) && (deadline - Date.now()) > 6000,
  })
}

export const geminiProvider = {
  name: 'gemini',
  extract: extractWithGemini,
  isSupportedMime,
}
