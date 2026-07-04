// Worker tick: polls the DB for one pending document and runs server-side
// Gemini extraction via POST /api/compliance/extract, then advances the row
// to waiting_for_review (or failed on error).
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { extractDocument, isExtractableStatus } from '../services/documentProcessor'

const POLL_MS = 15000

export function useDocumentWorker({ enabled = true } = {}) {
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState(null)
  const stopRef = useRef(false)
  const errorCountRef = useRef(0)

  useEffect(() => {
    if (!enabled) return undefined
    stopRef.current = false
    errorCountRef.current = 0

    async function markFailed(documentId, message) {
      await supabase.rpc('advance_document_processing', {
        p_document_id: documentId,
        p_next_status: 'failed',
        p_error: message,
      })
    }

    async function tick() {
      if (stopRef.current) return

      try {
        setBusy(true)

        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) {
          setLastResult({ error: 'not_authenticated' })
          return
        }

        const { data: docs, error } = await supabase.rpc('next_pending_document')
        if (error) throw error

        const doc = Array.isArray(docs) ? docs[0] : null
        if (!doc) {
          setLastResult(null)
          errorCountRef.current = 0
          return
        }

        if (!isExtractableStatus(doc.processing_status)) {
          setLastResult(null)
          return
        }

        // Visible pipeline step while Gemini runs.
        await supabase.rpc('advance_document_processing', {
          p_document_id: doc.id,
          p_next_status: 'ocr_processing',
        })

        let payload
        try {
          payload = await extractDocument(doc.id, session.access_token)
        } catch (extractErr) {
          const msg = extractErr?.message || 'Extraction failed'
          await markFailed(doc.id, msg)
          throw extractErr
        }

        const { error: advErr } = await supabase.rpc('advance_document_processing', {
          p_document_id:        doc.id,
          p_next_status:        payload.nextStatus || 'waiting_for_review',
          p_extracted_text:     payload.extractedText ?? null,
          p_extracted_metadata: payload.extractedMetadata ?? null,
          p_ai_summary:         payload.aiSummary ?? null,
          p_document_type:      payload.documentType ?? null,
          p_language:           payload.language ?? null,
          p_confidence:         payload.confidenceScore ?? null,
        })
        if (advErr) throw advErr

        setLastResult({ id: doc.id, status: payload.nextStatus || 'waiting_for_review' })
        errorCountRef.current = 0
      } catch (err) {
        errorCountRef.current += 1
        setLastResult({ error: err.message })
      } finally {
        setBusy(false)
      }
    }

    tick()
    const interval = setInterval(tick, POLL_MS)

    return () => {
      stopRef.current = true
      clearInterval(interval)
    }
  }, [enabled])

  return { busy, lastResult }
}
