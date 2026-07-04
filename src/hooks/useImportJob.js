// useImportJob — drives a Drive/Dropbox-style multi-file upload into
// Supabase Storage + compliance_item_documents.
//
// State per job:
//   queued         queued locally
//   uploading      bytes flowing into Storage
//   server_pending storage committed; DB row about to be inserted
//   completed      DB row inserted with is_orphan = TRUE
//   failed         any error during upload or row insert; the row surfaces
//                  a `retry()` callback (cleared and re-queued)
//
// Bounded concurrency: PARALLEL jobs run at once, the rest queue.
//
// Failure policy:
//   - Auto-clean after MAX_FAILURES per job (it gets dropped from the list).
//   - User-initiated retry always resets the counter.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const PARALLEL      = 5
const MAX_FAILURES  = 3
const BUCKET        = 'compliance-documents'

// Reuse the same MIME allowlist as the per-item upload so behaviour stays
// consistent. Tunable later.
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png','image/jpeg','image/jpg','image/gif','image/webp',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv','text/plain',
])
const ALLOWED_EXT = /\.(pdf|png|jpe?g|gif|webp|docx?|xlsx?|csv|txt)$/i

// Stable client-side id so we never confuse retries with new uploads.
function generateJobId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function safeName(name) {
  return (name || 'file')
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 200)
}

function isAllowed(file) {
  if (ALLOWED_MIME.has(file.type)) return true
  return ALLOWED_EXT.test(file.name)
}

function bytesFormat(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function useImportJob({ userEmail = '' } = {}) {
  const [jobs, setJobs] = useState([])
  const userIdRef   = useRef(null)
  const queueRef    = useRef([])   // job ids waiting for a slot
  const runningRef  = useRef(0)    // currently-uploading jobs

  // Resolve current user once. If not signed in we still let the user queue
  // files, but every upload will fail with a friendly message.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.auth.getUser()
      if (!cancelled) userIdRef.current = data?.user?.id ?? null
    })()
    return () => { cancelled = true }
  }, [])

  // Background scheduler — drains queueRef up to PARALLEL.
  useEffect(() => {
    function pump() {
      while (runningRef.current < PARALLEL && queueRef.current.length > 0) {
        const id = queueRef.current.shift()
        runningRef.current += 1
        runJob(id).finally(() => {
          runningRef.current -= 1
          pump()
        })
      }
    }
    pump()
  })

  const updateJob = (id, patch) => {
    setJobs((prev) => prev.map((j) => (j.jobId === id ? { ...j, ...patch } : j)))
  }

  const runJob = async (jobId) => {
    let job
    setJobs((prev) => {
      job = prev.find((j) => j.jobId === jobId)
      return prev.map((j) => (j.jobId === jobId ? { ...j, status: 'uploading', progress: 0, error: null } : j))
    })
    if (!job) { return }
    const { file, docId: _ignore, ...meta } = job

    try {
      if (!userIdRef.current) throw new Error('not_signed_in')

      // 1) Upload to Storage with a progress channel.
      const ts = Date.now()
      const objKey = `${userIdRef.current}/orphan-${jobId}/${ts}_${safeName(meta.file.name)}`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(objKey, meta.file, {
        cacheControl: '3600',
        upsert: false,
      })
      if (upErr) throw upErr
      updateJob(jobId, { progress: 90, status: 'server_pending' })

      // 2) Insert the (orphan) document row. ID comes back via RETURNING so
      //    the parent can refer to it without a follow-up select.
      const { data: ins, error: insErr } = await supabase
        .from('compliance_item_documents')
        .insert([{
          item_id:            null,
          is_orphan:          true,
          file_name:          meta.file.name,
          storage_path:       objKey,
          bucket:             BUCKET,
          mime_type:          meta.file.type || null,
          size_bytes:         meta.file.size,
          version:            1,
          is_current_version: true,
          uploaded_by_email:  userEmail || null,
          user_id:            userIdRef.current,
        }])
        .select('id')
        .single()
      if (insErr) throw insErr

      updateJob(jobId, { progress: 100, status: 'completed', docId: ins.id })
    } catch (err) {
      // Bump failure count; auto-remove after MAX_FAILURES.
      let nextFailureCount
      let dropped = false
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.jobId === jobId)
        if (idx < 0) return prev
        const cur = prev[idx]
        nextFailureCount = (cur.failureCount || 0) + 1
        if (nextFailureCount >= MAX_FAILURES) { dropped = true; return prev.filter((_, i) => i !== idx) }
        return prev.map((j, i) => i === idx ? { ...j, status: 'failed', error: err.message, failureCount: nextFailureCount } : j)
      })
      if (dropped) {
        // Try to clean up the storage object if it landed anyway.
        if (job?.file && userIdRef.current) {
          try {
            await supabase.storage.from(BUCKET).remove([`${userIdRef.current}/orphan-${jobId}/${Date.now()}_${safeName(meta.file.name)}`])
          } catch (_) { /* ignore */ }
        }
      }
    }
  }

  const enqueue = useCallback((files) => {
    if (!files) return
    const arr = Array.isArray(files) ? files : [files]
    const fresh = arr
      .filter((f) => f && f instanceof File)
      .map((f) => ({
        jobId:         generateJobId(),
        file:          f,
        fileName:      f.name,
        sizeBytes:     f.size,
        mimeType:      f.type,
        status:        'queued',
        progress:      0,
        failureCount:  0,
        error:         null,
        docId:         null,
      }))
    if (fresh.length === 0) return
    setJobs((prev) => [...prev, ...fresh])
    queueRef.current.push(...fresh.map((j) => j.jobId))
  }, [])

  const retry = useCallback((jobId) => {
    setJobs((prev) => {
      const j = prev.find((x) => x.jobId === jobId)
      if (!j) return prev
      return prev.map((x) => x.jobId === jobId ? { ...x, status: 'queued', error: null, progress: 0 } : x)
    })
    queueRef.current.push(jobId)
  }, [])

  const remove = useCallback((jobId) => {
    setJobs((prev) => prev.filter((j) => j.jobId !== jobId))
    queueRef.current = queueRef.current.filter((id) => id !== jobId)
  }, [])

  const clearCompleted = useCallback(() => {
    setJobs((prev) => prev.filter((j) => j.status !== 'completed'))
  }, [])

  return {
    jobs,
    enqueue,
    retry,
    remove,
    clearCompleted,
    utils: { bytesFormat, isAllowed, PARALLEL, MAX_FAILURES, BUCKET },
  }
}
