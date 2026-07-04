// Per-item documents section. Uploads to Supabase Storage (path:
// {user_id}/{item_id}/{file_name}) and records metadata in
// compliance_item_documents. The database trigger automatically writes a
// 'document_uploaded' / 'document_replaced' event to the timeline.
//
// Versioning: uploading a file with the SAME name as an existing document
// creates a new row with version = previous + 1 and previous_version_id set.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { useLanguage } from '../../context/LanguageContext'
import ConfirmDialog from '../ui/ConfirmDialog'
import Dropdown from '../ui/Dropdown'
import { Upload, Download, Trash2, MoreVertical, FileText, File, Clock } from '../ui/Icons'
import DocumentPreviewModal from './DocumentPreviewModal'
import ComplianceDocumentVersionHistory from './ComplianceDocumentVersionHistory'

const BUCKET = 'compliance-documents'

function safeFilename(name) {
  return name.replace(/[^\w.\-]+/g, '_')
}

function formatBytes(b) {
  if (!b || b < 1024) return `${b || 0} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export default function ComplianceItemDocuments({ itemId }) {
  const { t } = useLanguage()
  const { user } = useAuth()
  const { success, error: showError } = useToast()
  const fileInputRef = useRef(null)
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [previewTarget, setPreviewTarget] = useState(null)
  const [historyTarget, setHistoryTarget] = useState(null)

  const fetchDocs = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('compliance_item_documents')
        .select('*')
        .eq('item_id', itemId)
        .order('created_at', { ascending: false })
      if (error) throw error
      setDocs(data || [])
    } catch (err) {
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!itemId) return
    fetchDocs()
    const ch = supabase
      .channel(`compliance_documents_${itemId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compliance_item_documents', filter: `item_id=eq.${itemId}` }, () => fetchDocs())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [itemId])

  const handleFile = async (file) => {
    if (!file) return
    if (!user?.id) {
      showError('Sign in required to upload documents')
      return
    }
    try {
      setUploading(true)
      const cleanName = safeFilename(file.name)
      const storagePath = `${user.id}/${itemId}/${Date.now()}_${cleanName}`

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || undefined,
      })
      if (upErr) throw upErr

      // Versioning: if a doc with the same file_name exists, link the new
      // one to the most recent version.
      const prior = docs
        .filter((d) => d.file_name === file.name)
        .sort((a, b) => (b.version || 1) - (a.version || 1))[0]
      const nextVersion = (prior?.version || 0) + 1

      const { error: insErr } = await supabase.from('compliance_item_documents').insert([{
        item_id: itemId,
        file_name: file.name,
        storage_path: storagePath,
        bucket: BUCKET,
        mime_type: file.type || null,
        size_bytes: file.size || null,
        version: nextVersion,
        previous_version_id: prior?.id || null,
        uploaded_by_email: user.email || null,
        user_id: user.id,
      }])
      if (insErr) throw insErr

      success(t('compliance.document_uploaded'))
    } catch (err) {
      showError(t('compliance.upload_failed') + ': ' + err.message)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDownload = async (doc) => {
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60)
      if (error) throw error
      const a = document.createElement('a')
      a.href = data.signedUrl
      a.download = doc.file_name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (err) {
      showError(err.message)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      setDeleting(true)
      // Best-effort: remove the file from storage first.
      try { await supabase.storage.from(BUCKET).remove([deleteTarget.storage_path]) } catch (_) { /* ignore */ }
      const { error } = await supabase.from('compliance_item_documents').delete().eq('id', deleteTarget.id)
      if (error) throw error
      success(t('compliance.document_deleted'))
      setDeleteTarget(null)
    } catch (err) {
      showError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const onFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  if (loading) return <p className="text-sm text-gray-500 py-4">{t('common.loading')}</p>

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={onFileChange}
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 px-4 rounded text-sm flex items-center gap-2 disabled:opacity-50"
        >
          <Upload size={16} />
          {uploading ? t('common.loading') : t('compliance.uploadDocument')}
        </button>
        <p className="text-xs text-gray-500">{t('compliance.uploadHint')}</p>
      </div>

      {docs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed border-gray-200 rounded">
          <p className="text-sm text-gray-500">{t('compliance.noDocuments')}</p>
        </div>
      ) : (
        <ul className="space-y-1">
          {docs.map((doc) => {
            const isImage = (doc.mime_type || '').startsWith('image/')
            const Icon = isImage ? File : FileText
            return (
              <li key={doc.id} className="flex items-center gap-2 py-2 px-3 bg-white border border-gray-200 rounded hover:bg-gray-50">
                <Icon size={18} className="text-gray-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 truncate" title={doc.file_name}>{doc.file_name}</p>
                  <p className="text-[11px] text-gray-500">
                    {t('compliance.documentVersion', { version: doc.version })}
                    {doc.size_bytes ? ` · ${formatBytes(doc.size_bytes)}` : ''}
                    {doc.uploaded_by_email ? ` · ${doc.uploaded_by_email}` : ''}
                    {doc.previous_version_id ? ' · v+1' : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDownload(doc)}
                  className="p-2 rounded text-gray-600 hover:bg-gray-100"
                  title={t('common.download') || 'Download'}
                >
                  <Download size={16} />
                </button>
                <Dropdown
                  trigger={<MoreVertical size={18} />}
                  align="right"
                  className="inline-block"
                  items={[
                    { label: t('entities.viewDetails') || 'Preview', icon: FileText, onClick: () => setPreviewTarget(doc) },
                    { label: t('compliance.documentVersion.history'), icon: Clock, onClick: () => setHistoryTarget(doc) },
                    { divider: true },
                    { label: t('common.delete'), icon: Trash2, danger: true, onClick: () => setDeleteTarget(doc) },
                  ]}
                />
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t('common.deleteConfirmTitle')}
        message={t('compliance.deleteDocumentConfirm')}
        confirmLabel={t('common.delete')}
        isLoading={deleting}
        variant="danger"
      />

      <DocumentPreviewModal doc={previewTarget} open={!!previewTarget} onClose={() => setPreviewTarget(null)} />
      <ComplianceDocumentVersionHistory doc={historyTarget} open={!!historyTarget} onClose={() => { setHistoryTarget(null); fetchDocs() }} />
    </div>
  )
}