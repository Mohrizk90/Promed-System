export async function withRetry(fn, {
  attempts = 3,
  baseDelayMs = 1000,
  maxDelayMs = 8000,
  label = 'operation',
  shouldRetry = () => true,
} = {}) {
  let lastError
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn(i + 1)
    } catch (err) {
      lastError = err
      const retryable = shouldRetry(err, i + 1)
      if (!retryable || i >= attempts - 1) break
      const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** i))
      console.warn(`[extraction] ${label} attempt ${i + 1} failed, retrying in ${delay}ms`, err?.message || err)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastError
}

export function withTimeout(promise, ms, label = 'operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
    }),
  ])
}

export function isRetryableGeminiError(err) {
  const msg = `${err?.message || ''} ${err?.status || ''}`.toLowerCase()
  if (msg.includes('timeout')) return true
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('resource_exhausted')) return true
  if (msg.includes('503') || msg.includes('500') || msg.includes('unavailable')) return true
  if (msg.includes('fetch failed') || msg.includes('network')) return true
  return false
}
