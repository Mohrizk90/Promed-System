import { supabase } from './supabase'

const API_BASE = (import.meta.env?.VITE_API_BASE ? String(import.meta.env.VITE_API_BASE) : '').replace(/\/$/, '')
export const AGENT_CHAT_URL = `${API_BASE}/api/agent/chat`
const BUCKET = 'compliance-documents'

export async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Please sign in again')
  return token
}

async function readError(res) {
  try {
    const j = await res.json()
    return j?.error || res.statusText
  } catch {
    return res.statusText || `HTTP ${res.status}`
  }
}

async function postJson(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getAccessToken()}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res
}

/** Confirm / cancel / undo an agent action. */
export async function agentAction(op, actionId, { force = false } = {}) {
  const res = await postJson('/api/agent/action', { op, actionId, force })
  const data = await res.json()
  notifyDataChanged({ source: 'agent', op })
  return data
}

export async function transcribe(base64, mediaType) {
  const res = await postJson('/api/agent/transcribe', { audio: base64, mediaType })
  return res.json()
}

export async function speak(text) {
  const res = await postJson('/api/agent/speak', { text })
  return res.blob()
}

/** Upload an attachment to the owner's private folder; returns a short-lived link for the model. */
export async function uploadAttachment(file, userId) {
  const safe = file.name.replace(/[^\w.\-؀-ۿ]+/g, '_').slice(-80)
  const path = `${userId}/agent/${Date.now()}_${safe}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (error) throw error
  const { data, error: signErr } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60)
  if (signErr) throw signErr
  return { path, url: data.signedUrl, name: file.name, mime: file.type || 'application/octet-stream', size: file.size }
}

/** Every screen listens for this and reloads its data. */
export const DATA_CHANGED_EVENT = 'promed:data-changed'
export function notifyDataChanged(detail = {}) {
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail }))
}
