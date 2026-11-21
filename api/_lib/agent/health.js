// "Is the Gemini key working?" — checks each model the agent uses, plus one tiny real call.
// Never returns or logs the key itself.
import { MODELS } from './models.js'
import { aiErrorCode } from './errors.js'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

async function call(url, key, init = {}, fetchImpl = fetch) {
  const started = Date.now()
  try {
    const res = await fetchImpl(url, {
      ...init,
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(15000),
    })
    const body = await res.text()
    if (res.ok) return { ok: true, ms: Date.now() - started }
    let message = body.slice(0, 300)
    try { message = JSON.parse(body)?.error?.message || message } catch { /* not JSON */ }
    const code = aiErrorCode({ statusCode: res.status, message, responseBody: body }) || 'generic'
    return { ok: false, ms: Date.now() - started, status: res.status, code, message: message.slice(0, 200) }
  } catch (e) {
    return { ok: false, ms: Date.now() - started, code: aiErrorCode(e) || 'network', message: String(e.message || e).slice(0, 200) }
  }
}

export async function checkGemini({ fetchImpl = fetch } = {}) {
  const key = process.env.GEMINI_API_KEY
  const checkedAt = new Date().toISOString()
  if (!key) return { ok: false, code: 'key_missing', checkedAt, models: [] }

  const roles = [
    ['main', MODELS.main], ['fallback', MODELS.fallback], ['transcribe', MODELS.transcribe],
    ['speak', process.env.AGENT_TTS_MODEL || 'gemini-3.8-flash-tts'], ['search', MODELS.search],
  ]
  const seen = new Map()
  const models = await Promise.all(roles.map(async ([role, id]) => {
    if (!seen.has(id)) seen.set(id, call(`${BASE}/${encodeURIComponent(id)}`, key, {}, fetchImpl))
    return { role, id, ...(await seen.get(id)) }
  }))
  // One tiny real request: proves the key can actually generate (quota, billing), not just list models.
  const live = await call(`${BASE}/${encodeURIComponent(MODELS.main)}:generateContent`, key, {
    method: 'POST',
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with OK' }] }], generationConfig: { maxOutputTokens: 32 } }),
  }, fetchImpl)

  const failed = [live, ...models].find((m) => !m.ok)
  return { ok: !failed, code: failed ? failed.code : null, checkedAt, keyLength: key.length, live, models }
}
