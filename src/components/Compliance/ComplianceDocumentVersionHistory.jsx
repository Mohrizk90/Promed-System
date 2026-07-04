// Version history for one document chain (group by item_id + file_name).
// Lists every version with uploader + date + current marker, with Restore action.
import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { useLanguage } from '../../context/LanguageContext'
import ConfirmDialog from '../ui/ConfirmDialog'
import { Clock, RefreshCw } from '../ui/Icons'

export default function ComplianceDocumentVersionHistory({ doc, open, onClose }) {
  const { t } = useLanguage()
  const { user } = useAuth()
  const { success, error: showError } = useToast()
  const [versions, setVersions] = useState([])
  const [loading, setLoading] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState(null)
  const [restoring, setRestoring] = useState(false)

  const fetch = async () => {
    if (!doc) return
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('compliance_item_documents')
        .select('id, file_name, version, uploaded_by_email, created_at, is_current_version, storage_path, notes')
        .eq('item_id', doc.item_id)
        .eq('file_name', doc.file_name)
        .order('version', { ascending: false })
      if (error) throw error
      setVersions(data || [])
    } catch (err) {
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (open) fetch() }, [open, doc?.id])

  const handleRestore = async () => {
    if (!restoreTarget) return
    try {
      setRestoring(true)
      const { error } = await supabase.rpc('restore_document_version', {
        p_document_id: doc.id,
        p_version_id:   restoreTarget.id,
      })
      if (error) throw error
      success(t('compliance.documentVersion.restored'))
      setRestoreTarget(null)
      onClose?.()
    } catch (err) {
      showError(err.message)
    } finally {
      setRestoring(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Clock size={18} />
            {t('compliance.documentVersion.history')}
          </h3>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700">×</button>
        </div>
        <p className="text-xs text-gray-500 mb-3 truncate" title={doc?.file_name}>{doc?.file_name}</p>

        {loading ? (
          <p className="text-sm text-gray-500 py-4 text-center">{t('common.loading')}</p>
        ) : versions.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">{t('compliance.documentVersion.no_versions')}</p>
        ) : (
          <ul className="space-y-2 max-h-[60vh] overflow-y-auto">
            {versions.map((v) => {
              const isCurrent = !!v.is_current_version
              return (
                <li key={v.id} className="flex items-start gap-2 py-2 px-3 border border-gray-200 rounded">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900">
                        {t('compliance.documentVersion.version', { version: v.version })}
                      </p>
                      {isCurrent && (
                        <span className="inline px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800">
                          {t('compliance.documentVersion.current')}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500">
                      {t('compliance.documentVersion.uploader_label')}: {v.uploaded_by_email || t('compliance.documentVersion.unknown_uploader')}
                    </p>
                    <p className="text-[11px] text-gray-500">{new Date(v.created_at).toLocaleString()}</p>
                    {v.notes && <p className="text-[11px] text-gray-600 italic mt-0.5">{v.notes}</p>}
                  </div>
                  {!isCurrent && (
                    <button
                      type="button"
                      onClick={() => setRestoreTarget(v)}
                      className="text-xs text-rose-700 hover:underline inline-flex items-center gap-1 whitespace-nowrap"
                    >
                      <RefreshCw size={12} />
                      {t('compliance.documentVersion.restore')}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!restoreTarget}
        onClose={() => setRestoreTarget(null)}
        onConfirm={handleRestore}
        title={t('compliance.documentVersion.restore')}
        message={restoreTarget ? t('compliance.documentVersion.restore_confirm', { version: restoreTarget.version }) : ''}
        confirmLabel={t('common.confirm')}
        isLoading={restoring}
        variant="warning"
      />
    </div>
  )
}