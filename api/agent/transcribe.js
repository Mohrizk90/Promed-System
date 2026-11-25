// POST /api/agent/transcribe — voice note -> text (shown to the owner before the agent acts).
import { generateText } from 'ai'
import { authenticateRequest } from '../_lib/auth.js'
import { getGoogle, isRetryable, MODELS } from '../_lib/agent/models.js'
import { readJsonBody, requireMember, sendError } from '../_lib/agent/http.js'
import { createUsageLog, supabaseSaver } from '../_lib/agent/usage.js'

export const config = { maxDuration: 60 }

const MAX_BYTES = 12 * 1024 * 1024
const ALLOWED = /^audio\/(wav|x-wav|webm|ogg|mp4|mpeg|mp3|aac|m4a|x-m4a)(;.*)?$/i

export const TRANSCRIBE_PROMPT = `Transcribe this voice note exactly as spoken. The speaker is usually Egyptian and speaks Egyptian Arabic, often mixed with English business words (invoice, shipment, VAT, product and company names).
Rules:
- Output ONLY the transcript, nothing else. No quotes, no translation, no notes.
- Write Arabic in Arabic script and English words in Latin script, as spoken.
- Write every number and amount as digits (e.g. "ألفين وخمسمية" -> 2500, "تلتاشر ألف" -> 13000, "ميتين" -> 200).
- Keep names of people, companies, products and places exactly as heard.
- Amounts are Egyptian pounds unless another currency is clearly said. Never add a currency symbol that was not spoken.
- If there is no speech, output an empty string.`

async function transcribe(google, modelId, data, mediaType, names) {
  const hint = names?.length
    ? `
Company names you may hear (only use one of these spellings if you clearly hear that name; never insert a name that was not said): ${names.join(' · ')}`
    : ''
  const { text, usage, response } = await generateText({
    model: google(modelId),
    maxRetries: 1,
    temperature: 0,
    messages: [{ role: 'user', content: [{ type: 'text', text: TRANSCRIBE_PROMPT + hint }, { type: 'file', data, mediaType }] }],
  })
  return { text: text.trim(), usage, model: response?.modelId || modelId }
}

/** Company vocabulary: clients, suppliers, products, projects (helps with names). */
export async function loadNameHints(rpc) {
  try {
    const rows = await rpc('agent_ask_data', { p_sql: `select n from (
      select client_name::text as n from clients union select supplier_name from suppliers
      union select name from projects where deleted_at is null union select name from employees) x
      where length(n) between 3 and 50 limit 200` })
    return rows.map((r) => r.n)
  } catch {
    return []
  }
}

export async function transcribeAudio(google, data, mediaType, names = []) {
  try {
    const r = await transcribe(google, MODELS.transcribe, data, mediaType, names)
    return { text: r.text, model: MODELS.transcribe, usage: r.usage }
  } catch (e) {
    if (!isRetryable(e) && !/not found|not supported|invalid/i.test(e.message || '')) throw e
    const r = await transcribe(google, MODELS.transcribeFallback, data, mediaType, names)
    return { text: r.text, model: MODELS.transcribeFallback, usage: r.usage }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { userClient } = await authenticateRequest(req)
    await requireMember(userClient)
    const body = readJsonBody(req)
    const mediaType = String(body.mediaType || 'audio/wav')
    if (!ALLOWED.test(mediaType)) return res.status(400).json({ error: `Unsupported audio type ${mediaType}` })
    const audio = Buffer.from(String(body.audio || ''), 'base64')
    if (!audio.length) return res.status(400).json({ error: 'No audio' })
    if (audio.length > MAX_BYTES) return res.status(413).json({ error: 'Recording is too long' })
    const started = Date.now()
    const names = await loadNameHints(async (fn, args) => {
      const { data, error } = await userClient.rpc(fn, args)
      if (error) throw error
      return data
    })
    const out = await transcribeAudio(getGoogle(), audio, mediaType.split(';')[0], names)
    console.info(`[agent/transcribe] ${audio.length} bytes -> ${out.text.length} chars via ${out.model} in ${Date.now() - started} ms`)
    const log = createUsageLog({ save: supabaseSaver(userClient) })
    log.report({ feature: 'transcribe', model: out.model, usage: out.usage, meta: { bytes: audio.length } })
    await log.flush()
    return res.status(200).json({ text: out.text, model: out.model })
  } catch (err) {
    sendError(res, err, 'agent/transcribe')
  }
}
