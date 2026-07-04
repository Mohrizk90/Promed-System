// useImportJob — drives a Drive/Dropbox-style multi-file upload into
// Supabase Storage + compliance_item_documents.
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

function formatSupabaseError(err) {
  if (!err) return 'Unknown error'
  const parts = [err.message, err.details, err.hint, err.error].filter(Boolean)
  return parts.join(' — ') || String(err)
}

function friendlyError(err) {
  const msg = formatSupabaseError(err).toLowerCase()
  if (msg === 'not_signed_in' || msg.includes('not_signed_in')) {
    return 'Sign in required to upload documents'
  }
  if (msg.includes('timed out')) return formatSupabaseError(err)
  if (msg.includes('bucket') && msg.includes('not found')) {
    return 'Storage bucket missing — run Supabase/supabase_compliance_storage.sql'
  }
  if (
    msg.includes('row-level security')
    || msg.includes('is_orphan')
    || msg.includes('intended_title')
    || (msg.includes('item_id') && msg.includes('null'))
    || msg.includes('violates not-null constraint')
  ) {
    return 'Database not ready for import — run verify_compliance_import.sql in Supabase SQL Editor (includes trigger fix)'
  }
  if (msg.includes('log_compliance_document_event') || msg.includes('compliance_item_events')) {
    return 'Upload blocked by document timeline trigger — re-run verify_compliance_import.sql (section 5) in Supabase'
  }
  return formatSupabaseError(err)
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
    }),
  ])
}

async function insertOrphanRow({ uid, userEmail, file, objKey }) {
  const base = {
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
  }

  const { data, error } = await supabase
    .from('compliance_item_documents')
    .insert([base])
    .select('id')
    .single()

  if (!error) return data

  const msg = formatSupabaseError(error).toLowerCase()
  if (msg.includes('is_current_version') || msg.includes('processing_status')) {
    const retry = await supabase
      .from('compliance_item_documents')
      .insert([{
        item_id:       null,
        is_orphan:     true,
        file_name:     file.name,
        storage_path:  objKey,
        bucket:        BUCKET,
        mime_type:     file.type || null,
        size_bytes:    file.size,
        version:       1,
        uploaded_by_email: userEmail || null,
        user_id:       uid,
      }])
      .select('id')
      .single()
    if (!retry.error) return retry.data
    throw retry.error
  }

  throw error
}

export function useImportJob({
  userEmail = '',
  userId = null,
  onJobComplete = null,
  onJobFailed = null,
} = {}) {
  const [jobs, setJobs] = useState([])
  const queueRef         = useRef([])
  const runningRef       = useRef(0)
  const progressTimersRef = useRef(new Map())
  const jobFilesRef      = useRef(new Map())
  const userIdRef        = useRef(userId)
  const onCompleteRef    = useRef(onJobComplete)
  const onFailedRef      = useRef(onJobFailed)

  useEffect(() => { userIdRef.current = userId }, [userId])
  useEffect(() => { onCompleteRef.current = onJobComplete }, [onJobComplete])
  useEffect(() => { onFailedRef.current = onJobFailed }, [onJobFailed])

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
        const next = Math.min((j.progress || 8) + 5, 85)
        return next === j.progress ? j : { ...j, progress: next }
      }))
    }, 350)
    progressTimersRef.current.set(jobId, timer)
  }

  const updateJob = useCallback((id, patch) => {
    setJobs((prev) => prev.map((j) => (j.jobId === id ? { ...j, ...patch } : j)))
  }, [])

  const runJob = useCallback(async (jobId) => {
    const file = jobFilesRef.current.get(jobId)
    if (!file) {
      setJobs((prev) => prev.map((j) => (
        j.jobId === jobId ? { ...j, status: 'failed', error: 'Upload queue lost file reference — remove and add again' } : j
      )))
      return
    }

    setJobs((prev) => prev.map((j) => (
      j.jobId === jobId ? { ...j, status: 'uploading', progress: 8, error: null } : j
    )))

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

      const ins = await withTimeout(
        insertOrphanRow({ uid, userEmail, file, objKey }),
        30_000,
        'Save',
      )

      jobFilesRef.current.delete(jobId)
      updateJob(jobId, { progress: 100, status: 'completed', docId: ins.id })
      onCompleteRef.current?.({ jobId, docId: ins.id, fileName: file.name })
    } catch (err) {
      clearProgressTimer(jobId)
      if (objKey) {
        try { await supabase.storage.from(BUCKET).remove([objKey]) } catch (_) { /* ignore */ }
      }

      const message = friendlyError(err)
      onFailedRef.current?.({ jobId, fileName: file.name, message })

      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.jobId === jobId)
        if (idx < 0) return prev
        const cur = prev[idx]
        const nextFailureCount = (cur.failureCount || 0) + 1
        if (nextFailureCount >= MAX_FAILURES) {
          jobFilesRef.current.delete(jobId)
          return prev.filter((_, i) => i !== idx)
        }
        return prev.map((j, i) => (i === idx
          ? { ...j, status: 'failed', error: message, failureCount: nextFailureCount, progress: 0 }
          : j))
      })
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
    if (!userIdRef.current) {
      onFailedRef.current?.({ jobId: null, fileName: null, message: 'Sign in required to upload documents' })
      return
    }

    const arr = Array.isArray(files) ? files : [files]
    const fresh = arr
      .filter((f) => f && f instanceof File)
      .map((f) => {
        const jobId = generateJobId()
        jobFilesRef.current.set(jobId, f)
        return {
          jobId,
          file:          f,
          fileName:      f.name,
          sizeBytes:     f.size,
          mimeType:      f.type,
          status:        'queued',
          progress:      0,
          failureCount:  0,
          error:         null,
          docId:         null,
        }
      })
    if (fresh.length === 0) return
    setJobs((prev) => [...prev, ...fresh])
    queueRef.current.push(...fresh.map((j) => j.jobId))
    pump()
  }, [pump])

  const retry = useCallback((jobId) => {
    const file = jobFilesRef.current.get(jobId)
    setJobs((prev) => {
      const j = prev.find((x) => x.jobId === jobId)
      if (!j) return prev
      if (j.file && !file) jobFilesRef.current.set(jobId, j.file)
      return prev.map((x) => (x.jobId === jobId
        ? { ...x, status: 'queued', error: null, progress: 0, failureCount: 0 }
        : x))
    })
    queueRef.current.push(jobId)
    pump()
  }, [pump])

  const remove = useCallback((jobId) => {
    clearProgressTimer(jobId)
    jobFilesRef.current.delete(jobId)
    setJobs((prev) => prev.filter((j) => j.jobId !== jobId))
    queueRef.current = queueRef.current.filter((id) => id !== jobId)
  }, [])

  const clearCompleted = useCallback(() => {
    setJobs((prev) => prev.filter((j) => j.status !== 'completed'))
  }, [])

  useEffect(() => () => {
    for (const timer of progressTimersRef.current.values()) clearInterval(timer)
    progressTimersRef.current.clear()
    jobFilesRef.current.clear()
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
