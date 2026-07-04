import { handleExtractRequest, HttpError } from '../_lib/extraction/runner.js'

export const config = {
  maxDuration: 60,
}

function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string' && req.body.trim()) {
    try { return JSON.parse(req.body) } catch { return {} }
  }
  return {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    req.body = readJsonBody(req)
    const started = Date.now()
    const result = await handleExtractRequest(req)
    console.info(`[extract] document=${result.documentId} provider=${result.provider} ms=${Date.now() - started}`)
    return res.status(200).json(result)
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500
    const message = err?.message || 'Extraction failed'
    console.error('[extract] error', status, message, err?.stack || err)
    return res.status(status).json({ error: message })
  }
}
