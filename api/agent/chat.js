// POST /api/agent/chat — one streamed agent turn (AI SDK UI message stream).
import { createIdGenerator, pipeUIMessageStreamToResponse, toUIMessageStream } from 'ai'
import { authenticateRequest } from '../_lib/auth.js'
import { supabaseDb } from '../_lib/agent/db.js'
import { runAgent } from '../_lib/agent/run.js'
import { getGoogle } from '../_lib/agent/models.js'
import { readJsonBody, requireMember, sendError } from '../_lib/agent/http.js'
import { extractDocumentForUser } from '../_lib/extraction/runner.js'
import { aiErrorCode, streamErrorText } from '../_lib/agent/errors.js'

export const config = { maxDuration: 120 }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function titleFrom(messages) {
  const first = messages.find((m) => m.role === 'user')
  const text = (first?.parts || []).filter((p) => p.type === 'text').map((p) => p.text).join(' ').trim()
  return text.slice(0, 80) || 'New chat'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { user, userClient } = await authenticateRequest(req)
    await requireMember(userClient)
    const body = readJsonBody(req)
    const messages = Array.isArray(body.messages) ? body.messages : []
    if (!messages.length) return res.status(400).json({ error: 'No messages' })
    const conversationId = UUID.test(body.id || '') ? body.id : null

    if (conversationId) {
      await userClient.from('agent_conversations')
        .upsert({ id: conversationId, user_id: user.id, title: titleFrom(messages), updated_at: new Date().toISOString() }, { onConflict: 'id' })
    }

    const db = supabaseDb(userClient)
    const result = await runAgent({
      db,
      getGoogle,
      messages,
      conversationId,
      voiceText: typeof body.voiceText === 'string' ? body.voiceText.slice(0, 4000) : null,
      page: typeof body.page === 'string' ? body.page.slice(0, 200) : null,
      locale: body.locale === 'ar' ? 'ar' : 'en',
      extractDocument: async (documentId) => extractDocumentForUser({ documentId, user, outputLocale: body.locale === 'ar' ? 'ar' : 'en' }),
    })

    await pipeUIMessageStreamToResponse({
      response: res,
      stream: toUIMessageStream({
        stream: result.stream,
        originalMessages: messages,
        generateMessageId: createIdGenerator({ prefix: 'msg', size: 16 }),
        onError: (err) => {
          console.error('[agent/chat] stream error', aiErrorCode(err) || '', err?.message || err)
          return streamErrorText(err)
        },
        onEnd: async ({ messages: all }) => {
          if (!conversationId) return
          const rows = all.slice(-2).map((m) => ({
            conversation_id: conversationId, message_id: m.id, role: m.role, parts: m.parts, created_at: new Date().toISOString(),
          }))
          const { error } = await userClient.from('agent_messages').upsert(rows, { onConflict: 'conversation_id,message_id' })
          if (error) console.error('[agent/chat] save failed', error.message)
        },
      }),
    })
  } catch (err) {
    sendError(res, err, 'agent/chat')
  }
}
