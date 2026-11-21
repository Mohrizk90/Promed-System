// POST /api/agent/speak — read an agent reply aloud (only when "spoken replies" is on).
import { generateSpeech } from 'ai'
import { authenticateRequest } from '../_lib/auth.js'
import { getGoogle } from '../_lib/agent/models.js'
import { readJsonBody, requireMember, sendError } from '../_lib/agent/http.js'

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { userClient } = await authenticateRequest(req)
    await requireMember(userClient)
    const text = speakableText(readJsonBody(req).text)
    if (!text) return res.status(400).json({ error: 'Nothing to say' })
    const google = getGoogle()
    const result = await generateSpeech({ model: google.speech(TTS_MODEL), text, voice: VOICE, maxRetries: 1 })
    res.setHeader('Content-Type', result.audio.mediaType || 'audio/wav')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(Buffer.from(result.audio.uint8Array))
  } catch (err) {
    sendError(res, err, 'agent/speak')
  }
}
