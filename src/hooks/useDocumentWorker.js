// Worker tick: finds one document that still needs extraction and runs
// server-side Gemini extraction via POST /api/compliance/extract, then
// advances the row to waiting_for_review (or failed on error).
//
// Selection is done directly (not via next_pending_document) so that:
//   - freshly uploaded orphan docs (status 'uploaded') are processed,
//   - newly queued item docs are processed,
//   - waiting_for_review / terminal docs never block the queue,
//   - stuck 'ocr_processing' docs are retried after a staleness window.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { extractDocument, isAiSupportedMime } from '../services/documentProcessor'

const POLL_MS = 15000
const STALE_MS = 120000 // recover docs stuck in ocr_processing

const DOC_FIELDS = 'id, item_id, file_name, mime_type, processing_status, updated_at'

async function pickNextDoc() {
  // 1) Fresh work: never-processed uploads or queued item docs.
  const { data: fresh, error: freshErr } = await supabase
    .from('compliance_item_documents')
    .select(DOC_FIELDS)
    .in('processing_status', ['uploaded', 'queued'])
    .order('created_at', { ascending: true })
    .limit(1)
  if (freshErr) throw freshErr
  if (fresh && fresh[0]) return fresh[0]

  // 2) Recover docs stuck mid-extraction beyond the staleness window.
  const cutoff = new Date(Date.now() - STALE_MS).toISOString()
  const { data: stuck, error: stuckErr } = await supabase
    .from('compliance_item_documents')
    .select(DOC_FIELDS)
    .eq('processing_status', 'ocr_processing')
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(1)
  if (stuckErr) throw stuckErr
  return stuck?.[0] || null
}

export function useDocumentWorker({ enabled = true, outputLocale = 'en' } = {}) {
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState(null)
  const stopRef = useRef(false)
  const inFlightRef = useRef(false)

  useEffect(() => {
    if (!enabled) return undefined
    stopRef.current = false

    async function advance(documentId, patch) {
      const { error } = await supabase.rpc('advance_document_processing', {
        p_document_id: documentId,
        ...patch,
      })
      if (error) throw error
    }

    async function tick() {
      if (stopRef.current || inFlightRef.current) return
      inFlightRef.current = true
      try {
        setBusy(true)

        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) {
          setLastResult({ error: 'not_authenticated' })
          return
        }

        const doc = await pickNextDoc()
        if (!doc) { setLastResult(null); return }

        // Unsupported types skip AI and go straight to manual review.
        if (!isAiSupportedMime(doc.mime_type)) {
          await advance(doc.id, {
            p_next_status: 'waiting_for_review',
            p_ai_summary: 'Automatic extraction not available for this file type. Please review manually.',
            p_confidence: 0,
          })
          setLastResult({ id: doc.id, status: 'waiting_for_review', skipped: true })
          return
        }

        // Visible pipeline step while Gemini runs.
        await advance(doc.id, { p_next_status: 'ocr_processing' })

        let payload
        try {
          payload = await extractDocument(doc.id, session.access_token, outputLocale)
        } catch (extractErr) {
          await advance(doc.id, {
            p_next_status: 'failed',
            p_error: extractErr?.message || 'Extraction failed',
          })
          setLastResult({ error: extractErr?.message, id: doc.id })
          return
        }

        await advance(doc.id, {
          p_next_status:        payload.nextStatus || 'waiting_for_review',
          p_extracted_text:     payload.extractedText ?? null,
          p_extracted_metadata: payload.extractedMetadata ?? null,
          p_ai_summary:         payload.aiSummary ?? null,
          p_document_type:      payload.documentType ?? null,
          p_language:           payload.language ?? null,
          p_confidence:         payload.confidenceScore ?? null,
        })

        setLastResult({ id: doc.id, status: payload.nextStatus || 'waiting_for_review' })
      } catch (err) {
        setLastResult({ error: err.message })
      } finally {
        inFlightRef.current = false
        setBusy(false)
      }
    }

    tick()
    const interval = setInterval(tick, POLL_MS)

    return () => {
      stopRef.current = true
      clearInterval(interval)
    }
  }, [enabled, outputLocale])

  return { busy, lastResult }
}
