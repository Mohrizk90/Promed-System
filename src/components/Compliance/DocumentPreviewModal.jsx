// Inline document preview in a modal: embeds PDF via signed URL or shows an
// image. Other file types get a download link instead.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../context/LanguageContext'
import Modal from '../ui/Modal'

export default function DocumentPreviewModal({ doc, open, onClose }) {
  const { t } = useLanguage()
  const [url, setUrl] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open || !doc) return undefined
    let cancelled = false
    setLoading(true); setError(null); setUrl(null)
    ;(async () => {
      try {
        const { data, error: signErr } = await supabase.storage
          .from(doc.bucket || 'compliance-documents')
          .createSignedUrl(doc.storage_path, 120)
        if (signErr) throw signErr
        if (!cancelled) setUrl(data.signedUrl)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, doc])

  if (!open || !doc) return null

  const isPdf = (doc.mime_type || '').includes('pdf')
  const isImage = (doc.mime_type || '').startsWith('image/')

  return (
    <Modal isOpen={open} onClose={onClose} title={doc.file_name} size="xl">
      {loading ? (
        <p className="text-sm text-gray-500 py-6 text-center">{t('common.loading')}</p>
      ) : error ? (
        <p className="text-sm text-red-700 py-6 text-center">{error}</p>
      ) : isPdf ? (
        <iframe title={doc.file_name} src={url} className="w-full" style={{ height: '70vh' }} />
      ) : isImage ? (
        <img src={url} alt={doc.file_name} className="max-w-full max-h-[70vh] mx-auto" />
      ) : (
        <div className="py-6 text-center">
          <p className="text-sm text-gray-600 mb-3">{doc.mime_type || 'unknown type'}</p>
          <a href={url} download={doc.file_name} className="btn btn-primary inline-flex items-center gap-2">
            Download
          </a>
        </div>
      )}
    </Modal>
  )
}