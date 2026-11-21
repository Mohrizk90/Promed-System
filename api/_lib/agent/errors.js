// Turn Gemini / network failures into a short code the app can explain in the owner's language.
// Codes: key_missing, key_invalid, key_blocked, billing, quota, busy, model, network.

function collect(err, out = [], depth = 0) {
  if (!err || depth > 4) return out
  out.push(err)
  if (err.lastError && err.lastError !== err) collect(err.lastError, out, depth + 1)
  if (Array.isArray(err.errors)) for (const e of err.errors) collect(e, out, depth + 1)
  if (err.cause && err.cause !== err) collect(err.cause, out, depth + 1)
  return out
}

export function aiErrorCode(err) {
  if (!err) return null
  const all = collect(err)
  const text = all.map((e) => `${e.message || ''} ${typeof e.responseBody === 'string' ? e.responseBody : ''}`).join(' ').toLowerCase()
  const statuses = all.map((e) => Number(e.statusCode ?? e.status)).filter(Boolean)
  const has = (s) => statuses.includes(s)

  if (/gemini_api_key is not set/.test(text)) return 'key_missing'
  if (/api key not valid|api_key_invalid|api key expired|invalid api key|api key.*(renew|invalid)/.test(text)) return 'key_invalid'
  if (/api_key_service_blocked|permission_denied|has not been used in project|are blocked|unregistered callers|leaked/.test(text) || has(401) || has(403)) return 'key_blocked'
  if (/billing|failed_precondition|free tier is not available/.test(text)) return 'billing'
  if (/resource.?exhausted|quota|rate.?limit|too many requests/.test(text) || has(429)) return 'quota'
  if (/not found for api version|is not supported for|model.*not found|no such model/.test(text) || has(404)) return 'model'
  if (/overloaded|high demand|unavailable|deadline|timeout/.test(text) || [500, 502, 503, 504].some(has)) return 'busy'
  if (/fetch failed|econnreset|enotfound|etimedout|socket hang up|network/.test(text)) return 'network'
  return null
}

/** The marker the chat stream sends instead of a raw error (the UI translates it). */
export const streamErrorText = (err) => `AGENT_ERROR:${aiErrorCode(err) || 'generic'}`
