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
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const PARALLEL      = 5
const MAX_FAILURES  = 3
const UPLOAD_TIMEOUT_MS = 120_000
const BUCKET        = 'compliance-documents'

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png','image/jpeg','image/jpg','image/gif','image/webp',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv','text/plain',
])
const ALLOWED_EXT = /\.(pdf|png|jpe?g|gif|webp|docx?|xlsx?|csv|txt)$/i

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

function friendlyError(err) {
  const msg = err?.message || String(err)
  if (msg === 'not_signed_in') return 'Sign in required to upload documents'
  if (msg.includes('Upload timed out')) return msg
  if (msg.includes('row-level security') || msg.includes('RLS')) {
    return 'Upload blocked by database permissions — run the compliance import SQL migration'
  }
  return msg
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
    }),
  ])
}

export function useImportJob({ userEmail = '', userId = null } = {}) {
  const [jobs, setJobs] = useState([])
  const queueRef    = useRef([])
  const runningRef  = useRef(0)
  const progressTimersRef = useRef(new Map())
  const userIdRef   = useRef(userId)

  useEffect(() => {
    userIdRef.current = userId
  }, [userId])

  const clearProgressTimer = (jobId) => {
    const timer = progressTimersRef.current.get(jobId)
    if (timer) {
      clearInterval(timer)
      progressTimersRef.current.delete(jobId)
    }
  }

  const startProgressPulse = (jobId) => {
    clearProgressTimer(jobId)
    const timer = setInterval(() => {
      setJobs((prev) => prev.map((j) => {
        if (j.jobId !== jobId || j.status !== 'uploading') return j
        const next = Math.min((j.progress || 4) + 4, 85)
        return next === j.progress ? j : { ...j, progress: next }
      }))
    }, 400)
    progressTimersRef.current.set(jobId, timer)
  }

  const updateJob = useCallback((id, patch) => {
    setJobs((prev) => prev.map((j) => (j.jobId === id ? { ...j, ...patch } : j)))
  }, [])

  const runJob = useCallback(async (jobId) => {
    let job
    setJobs((prev) => {
      job = prev.find((j) => j.jobId === jobId)
      return prev.map((j) => (j.jobId === jobId
        ? { ...j, status: 'uploading', progress: 8, error: null }
        : j))
    })
    if (!job?.file) return

    const file = job.file
    let objKey = null

    try {
      const uid = userIdRef.current
      if (!uid) throw new Error('not_signed_in')

      startProgressPulse(jobId)

      const ts = Date.now()
      objKey = `${uid}/orphan-${jobId}/${ts}_${safeName(file.name)}`

      const { error: upErr } = await withTimeout(
        supabase.storage.from(BUCKET).upload(objKey, file, {
          cacheControl: '3600',
          upsert: false,
        }),
        UPLOAD_TIMEOUT_MS,
        'Upload',
      )
      if (upErr) throw upErr

      clearProgressTimer(jobId)
      updateJob(jobId, { progress: 92, status: 'server_pending' })

      const { data: ins, error: insErr } = await withTimeout(
        supabase
          .from('compliance_item_documents')
          .insert([{
            item_id:            null,
            is_orphan:          true,
            file_name:          file.name,
            storage_path:       objKey,
            bucket:             BUCKET,
            mime_type:          file.type || null,
            size_bytes:         file.size,
            version:            1,
            is_current_version: true,
            uploaded_by_email:  userEmail || null,
            user_id:            uid,
          }])
          .select('id')
          .single(),
        30_000,
        'Save',
      )
      if (insErr) throw insErr

      updateJob(jobId, { progress: 100, status: 'completed', docId: ins.id })
    } catch (err) {
      clearProgressTimer(jobId)
      if (objKey) {
        try { await supabase.storage.from(BUCKET).remove([objKey]) } catch (_) { /* ignore */ }
      }

      const message = friendlyError(err)
      let dropped = false
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.jobId === jobId)
        if (idx < 0) return prev
        const cur = prev[idx]
        const nextFailureCount = (cur.failureCount || 0) + 1
        if (nextFailureCount >= MAX_FAILURES) {
          dropped = true
          return prev.filter((_, i) => i !== idx)
        }
        return prev.map((j, i) => (i === idx
          ? { ...j, status: 'failed', error: message, failureCount: nextFailureCount, progress: 0 }
          : j))
      })
      if (dropped) { /* row removed after max failures */ }
    }
  }, [updateJob, userEmail])

  const pump = useCallback(() => {
    while (runningRef.current < PARALLEL && queueRef.current.length > 0) {
      const id = queueRef.current.shift()
      runningRef.current += 1
      runJob(id).finally(() => {
        runningRef.current -= 1
        pump()
      })
    }
  }, [runJob])

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
    pump()
  }, [pump])

  const retry = useCallback((jobId) => {
    setJobs((prev) => {
      const j = prev.find((x) => x.jobId === jobId)
      if (!j) return prev
      return prev.map((x) => (x.jobId === jobId
        ? { ...x, status: 'queued', error: null, progress: 0, failureCount: 0 }
        : x))
    })
    queueRef.current.push(jobId)
    pump()
  }, [pump])

  const remove = useCallback((jobId) => {
    clearProgressTimer(jobId)
    setJobs((prev) => prev.filter((j) => j.jobId !== jobId))
    queueRef.current = queueRef.current.filter((id) => id !== jobId)
  }, [])

  const clearCompleted = useCallback(() => {
    setJobs((prev) => prev.filter((j) => j.status !== 'completed'))
  }, [])

  useEffect(() => () => {
    for (const timer of progressTimersRef.current.values()) clearInterval(timer)
    progressTimersRef.current.clear()
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
