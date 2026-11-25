// One agent turn: shared by the HTTP handler and the evaluation tests.
import { convertToModelMessages, isStepCount, streamText } from 'ai'
import { buildInstructions, turnContext } from './prompt.js'
import { createTools } from './tools.js'
import { modelWithFallback, MODELS } from './models.js'

const MAX_HISTORY = 40

/**
 * Keep the last messages, and only send real file bytes for the newest user message
 * (older attachments become a one-line note so old signed links are never re-fetched).
 */
export function prepareUiMessages(messages = []) {
  const recent = messages.slice(-MAX_HISTORY)
  const lastUserIdx = recent.map((m) => m.role).lastIndexOf('user')
  return recent.map((m, i) => {
    if (!Array.isArray(m.parts)) return m
    const parts = m.parts.flatMap((p) => {
      if (p.type === 'file' && i !== lastUserIdx) return [{ type: 'text', text: `[Attached file: ${p.filename || p.mediaType}]` }]
      if (p.type === 'file' && p.mediaType && !/^(image\/|application\/pdf|audio\/|text\/)/.test(p.mediaType)) {
        return [{ type: 'text', text: `[Attached file ${p.filename || ''} (${p.mediaType}) cannot be read directly]` }]
      }
      return [p]
    })
    return { ...m, parts }
  })
}

/**
 * Put the per-turn app context in front of the newest user message. Earlier messages stay
 * byte-for-byte the same between turns, so Gemini can serve them from its cache.
 */
export function withTurnContext(modelMessages, note) {
  const idx = modelMessages.map((m) => m.role).lastIndexOf('user')
  if (idx < 0) return modelMessages
  const msg = modelMessages[idx]
  const parts = typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : msg.content
  const out = modelMessages.slice()
  out[idx] = { ...msg, content: [{ type: 'text', text: note }, ...parts] }
  return out
}

/**
 * @param {object} o
 * @param {{rpc: Function}} o.db
 * @param {Function} o.getGoogle
 * @param {any[]} o.messages          UI messages
 * @param {string|null} [o.conversationId]
 * @param {string|null} [o.voiceText]
 * @param {string|null} [o.page]
 * @param {string|null} [o.locale]
 * @param {Function} [o.extractDocument]
 * @param {string} [o.model]          override model id (evals)
 * @param {AbortSignal} [o.abortSignal]
 * @param {{report: Function}} [o.usage]  Gemini usage log (web search reports into it)
 */
export async function runAgent(o) {
  const [context, recentActions] = await Promise.all([
    o.db.rpc('agent_context', {}),
    o.conversationId ? o.db.rpc('agent_recent_actions', { p_conversation: o.conversationId, p_limit: 10 }) : Promise.resolve([]),
  ])
  const last = [...o.messages].reverse().find((m) => m.role === 'user')
  const attachments = Array.isArray(last?.metadata?.attachments) ? last.metadata.attachments : []

  const google = o.getGoogle()
  const tools = createTools({
    db: o.db,
    conversationId: o.conversationId || null,
    voiceText: o.voiceText || null,
    settings: context?.settings || {},
    lists: context || {},
    getGoogle: o.getGoogle,
    extractDocument: o.extractDocument,
    usage: o.usage,
  })

  return streamText({
    model: modelWithFallback(google, o.model || MODELS.main),
    instructions: buildInstructions({ context }),
    messages: withTurnContext(
      await convertToModelMessages(prepareUiMessages(o.messages), { tools, ignoreIncompleteToolCalls: true }),
      turnContext({ context, recentActions, page: o.page, locale: o.locale, attachments }),
    ),
    tools,
    stopWhen: isStepCount(12),
    maxRetries: 1,
    temperature: 0.2,
    providerOptions: { google: { thinkingConfig: { thinkingLevel: process.env.AGENT_THINKING || 'low' } } },
    abortSignal: o.abortSignal,
  })
}
