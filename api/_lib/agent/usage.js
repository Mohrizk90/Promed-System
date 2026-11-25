// Gemini usage log: every Gemini call reports its token counts, saved to public.ai_usage.
// The cost is computed in the database from public.ai_prices (dated, so price changes apply by date).
const FEATURES = new Set(['chat', 'transcribe', 'speak', 'web_search', 'document_scan', 'other'])
const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0)

/** Turn an AI SDK usage object (v7 shape, with older field names as fallback) into a row. */
export function usageRow({ feature, model, usage = {}, conversationId = null, meta = null }) {
  const input = n(usage.inputTokens?.total ?? usage.inputTokens)
  const cached = n(usage.inputTokenDetails?.cacheReadTokens ?? usage.inputTokens?.cacheRead ?? usage.cachedInputTokens)
  const output = n(usage.outputTokens?.total ?? usage.outputTokens)
  const reasoning = n(usage.outputTokenDetails?.reasoningTokens ?? usage.outputTokens?.reasoning ?? usage.reasoningTokens)
  return {
    feature: FEATURES.has(feature) ? feature : 'other',
    model: String(model || 'unknown').replace(/^models\//, ''),
    conversation_id: conversationId,
    input_tokens: input,
    cached_tokens: Math.min(cached, input),
    // Gemini reports thinking separately from the answer; both are billed as output.
    output_tokens: output < reasoning ? output + reasoning : output,
    reasoning_tokens: reasoning,
    meta,
  }
}

/**
 * A per-request usage log. report() collects calls; flush() saves them (as the signed-in user,
 * through RLS). Saving never breaks the request: failures are only printed.
 * @param {{save?: (rows: object[]) => Promise<void>, conversationId?: string|null}} o
 */
export function createUsageLog({ save, conversationId = null } = {}) {
  const rows = []
  return {
    rows,
    report(entry) {
      try {
        rows.push(usageRow({ conversationId, ...entry }))
      } catch (e) {
        console.error('[usage] bad entry', e.message)
      }
    },
    async flush() {
      if (!save || !rows.length) return
      const batch = rows.splice(0)
      try {
        await save(batch)
      } catch (e) {
        console.error('[usage] save failed', e.message)
      }
    },
  }
}

/** Gemini's raw usageMetadata (REST / @google/generative-ai) in the AI SDK shape. */
export function fromGeminiMetadata(m = {}) {
  const thoughts = Number(m.thoughtsTokenCount || 0)
  return {
    inputTokens: Number(m.promptTokenCount || 0) + Number(m.toolUsePromptTokenCount || 0),
    cachedInputTokens: Number(m.cachedContentTokenCount || 0),
    outputTokens: Number(m.candidatesTokenCount || 0) + thoughts,
    reasoningTokens: thoughts,
  }
}

/** save() for a Supabase client acting as the user. */
export const supabaseSaver = (userClient) => async (rows) => {
  const { error } = await userClient.from('ai_usage').insert(rows)
  if (error) throw new Error(error.message)
}
