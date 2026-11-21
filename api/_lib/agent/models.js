// Gemini models for the agent. Names come from env so they can change without code edits.
import { createGoogle } from '@ai-sdk/google'
import { wrapLanguageModel } from 'ai'

export const MODELS = {
  main: process.env.AGENT_MODEL || 'gemini-3.8-flash',
  fallback: process.env.AGENT_MODEL_FALLBACK || 'gemini-3.5-flash',
  search: process.env.AGENT_SEARCH_MODEL || 'gemini-3.5-flash',
  transcribe: process.env.AGENT_TRANSCRIBE_MODEL || 'gemini-3.5-transcribe',
  transcribeFallback: process.env.AGENT_TRANSCRIBE_FALLBACK || 'gemini-3.5-flash',
}

export function getGoogle() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set on the server')
  return createGoogle({ apiKey })
}

/** Busy / rate-limited / temporarily down: worth trying again or switching model. */
export function isRetryable(err) {
  if (!err) return false
  if (err.lastError && err.lastError !== err && isRetryable(err.lastError)) return true
  const status = err.statusCode ?? err.status ?? err.cause?.statusCode
  if ([408, 429, 500, 502, 503, 504].includes(Number(status))) return true
  const msg = String(err.message || '').toLowerCase()
  return /overloaded|high demand|unavailable|resource.?exhausted|quota|rate.?limit|too many requests|try again|timeout|fetch failed/.test(msg)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Primary model, one quick retry, then the fallback model. The switch happens before any
 * output is streamed (the error is thrown when the request is made), so users never see a
 * half answer from one model glued to another.
 */
export function modelWithFallback(google, primaryId = MODELS.main, fallbackId = MODELS.fallback, log = console) {
  const fallback = google(fallbackId)
  const attempt = async (call, viaFallback) => {
    try {
      return await call()
    } catch (e1) {
      if (!isRetryable(e1)) throw e1
      await sleep(700)
      try {
        return await call()
      } catch (e2) {
        if (!isRetryable(e2) || primaryId === fallbackId) throw e2
        log.warn?.(`[agent] ${primaryId} unavailable (${e2.message}); using ${fallbackId}`)
        return viaFallback()
      }
    }
  }
  return wrapLanguageModel({
    model: google(primaryId),
    middleware: {
      specificationVersion: 'v4',
      wrapGenerate: ({ doGenerate, params }) => attempt(doGenerate, () => fallback.doGenerate(params)),
      wrapStream: ({ doStream, params }) => attempt(doStream, () => fallback.doStream(params)),
    },
  })
}
