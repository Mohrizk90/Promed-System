import { createUserClient, createServiceClient } from './supabaseAdmin.js'

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization
  if (!header || typeof header !== 'string') return null
  const m = header.match(/^Bearer\s+(.+)$/i)
  return m?.[1] || null
}

export async function authenticateRequest(req) {
  const token = getBearerToken(req)
  if (!token) throw new HttpError(401, 'Missing Authorization bearer token')

  const userClient = createUserClient(token)
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) throw new HttpError(401, 'Invalid or expired session')

  return { user, token, userClient }
}

export async function loadDocumentForUser(documentId, user) {
  const id = Number(documentId)
  if (!Number.isFinite(id) || id <= 0) {
    throw new HttpError(400, 'Invalid documentId')
  }

  const service = createServiceClient()
  const { data: doc, error } = await service
    .from('compliance_item_documents')
    .select('id, item_id, is_orphan, user_id, file_name, storage_path, bucket, mime_type, size_bytes, processing_status')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new HttpError(500, error.message)
  if (!doc) throw new HttpError(404, 'Document not found')

  const uid = user.id

  if (doc.user_id && doc.user_id === uid) return doc

  if (doc.item_id) {
    const { data: item, error: itemErr } = await service
      .from('compliance_items')
      .select('id, user_id')
      .eq('id', doc.item_id)
      .maybeSingle()
    if (itemErr) throw new HttpError(500, itemErr.message)
    if (item && (item.user_id == null || item.user_id === uid)) return doc
  }

  if (doc.is_orphan && (doc.user_id == null || doc.user_id === uid)) return doc

  throw new HttpError(403, 'Not authorized to process this document')
}

export async function downloadDocumentBytes(doc) {
  const service = createServiceClient()
  const bucket = doc.bucket || 'compliance-documents'
  const { data, error } = await service.storage.from(bucket).download(doc.storage_path)
  if (error) throw new HttpError(502, `Storage download failed: ${error.message}`)
  const ab = await data.arrayBuffer()
  return Buffer.from(ab)
}
