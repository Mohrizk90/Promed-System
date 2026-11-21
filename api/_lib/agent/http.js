import { HttpError } from '../auth.js'

export function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string' && req.body.trim()) {
    try { return JSON.parse(req.body) } catch { return {} }
  }
  return {}
}

export function sendError(res, err, tag) {
  const status = err instanceof HttpError ? err.status : (err?.status && Number(err.status) < 600 ? Number(err.status) : 500)
  const message = err?.message || 'Something went wrong'
  console.error(`[${tag}]`, status, message)
  if (!res.headersSent) res.status(status).json({ error: message })
}

/** The agent is for company members only (and today: the owner). */
export async function requireMember(userClient) {
  const { data, error } = await userClient.rpc('is_member')
  if (error) throw new HttpError(500, error.message)
  if (!data) throw new HttpError(403, 'This account is not a Promed member')
}
