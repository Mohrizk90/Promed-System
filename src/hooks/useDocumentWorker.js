// Worker tick: polls the DB for one queued document every 30s and advances it
// through the pipeline by one step per tick. Single global timer (per page),
// shared across compliance tabs.
//
// Today this calls src/services/documentProcessor.js (a deterministic stub).
// When a real OCR / LLM service is wired up, swap that import for an HTTP call.
// The DB functions never change.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { processStep, finalizeForReview } from '../services/documentProcessor'

const POLL_MS = 30000
const BACKOFF_ERRORS = 3       // after this many consecutive errors, slow down

export function useDocumentWorker({ enabled = true } = {}) {
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState(null)
  const stopRef = useRef(false)
  const errorCountRef = useRef(0)

  useEffect(() => {
    if (!enabled) return undefined
    stopRef.current = false
    errorCountRef.current = 0

    async function tick() {
      if (stopRef.current) return
      try {
        setBusy(true)
        const { data: docs, error } = await supabase.rpc('next_pending_document')
        if (error) throw error
        const doc = Array.isArray(docs) ? docs[0] : null
        if (!doc) { setLastResult(null); return }

        let payload = null
        if (doc.processing_status !== 'metadata_extracted') {
          payload = await processStep(doc)
        } else {
          payload = await finalizeForReview(doc)
        }
        if (!payload) { setLastResult(null); return }

        const { error: advErr } = await supabase.rpc('advance_document_processing', {
          p_document_id:        doc.id,
          p_next_status:        payload.nextStatus,
          p_extracted_text:     payload.extractedText ?? null,
          p_extracted_metadata: payload.extractedMetadata ?? null,
          p_ai_summary:         payload.aiSummary ?? null,
          p_document_type:      payload.documentType ?? null,
          p_language:           payload.language ?? null,
          p_confidence:         payload.confidenceScore ?? null,
        })
        if (advErr) throw advErr
        setLastResult({ id: doc.id, status: payload.nextStatus })
        errorCountRef.current = 0
      } catch (err) {
        errorCountRef.current += 1
        setLastResult({ error: err.message })
      } finally {
        setBusy(false)
      }
    }

    // Run once on mount, then every POLL_MS.
    tick()
    const interval = setInterval(tick, POLL_MS)
    return () => {
      stopRef.current = true
      clearInterval(interval)
    }
  }, [enabled])

  return { busy, lastResult }
}
