// POST /api/agent/speak — read an agent reply aloud (only when "spoken replies" is on).
import { generateSpeech } from 'ai'
import { authenticateRequest } from '../_lib/auth.js'
import { getGoogle } from '../_lib/agent/models.js'
import { readJsonBody, requireMember, sendError } from '../_lib/agent/http.js'
import { createUsageLog, fromGeminiMetadata, supabaseSaver } from '../_lib/agent/usage.js'

export const config = { maxDuration: 60 }

const TTS_MODEL = process.env.AGENT_TTS_MODEL || 'gemini-3.8-flash-tts'
const VOICE = process.env.AGENT_TTS_VOICE || 'Charon'

export function speakableText(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#>`|]/g, ' ')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 700)
}

/**
 * Token counts for one read-aloud call. Google sometimes returns them; otherwise estimate:
 * audio output is 25 tokens per second (16-bit mono PCM), text input about 1 token per 3 characters.
 */
export function speechUsage(result, text) {
  const meta = result?.responses?.find?.((r) => r?.body?.usageMetadata)?.body?.usageMetadata
  if (meta) return fromGeminiMetadata(meta)
  const rate = Number(result?.providerMetadata?.google?.sampleRate) || 24000
  const bytes = result?.audio?.uint8Array?.length || 0
  const seconds = Math.max(0, bytes - 44) / (2 * rate)
  return { inputTokens: Math.ceil(String(text || '').length / 3), outputTokens: Math.ceil(seconds * 25) }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { userClient } = await authenticateRequest(req)
    await requireMember(userClient)
    const text = speakableText(readJsonBody(req).text)
    if (!text) return res.status(400).json({ error: 'Nothing to say' })
    const google = getGoogle()
    const result = await generateSpeech({ model: google.speech(TTS_MODEL), text, voice: VOICE, maxRetries: 1 })
    const log = createUsageLog({ save: supabaseSaver(userClient) })
    log.report({ feature: 'speak', model: TTS_MODEL, usage: speechUsage(result, text), meta: { chars: text.length } })
    await log.flush()
    res.setHeader('Content-Type', result.audio.mediaType || 'audio/wav')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(Buffer.from(result.audio.uint8Array))
  } catch (err) {
    sendError(res, err, 'agent/speak')
  }
}
