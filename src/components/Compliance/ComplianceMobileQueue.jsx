// Mobile queue — uploads in progress, needs review, failed (compact lists).
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../context/LanguageContext'
import { useToast } from '../../context/ToastContext'
import { ORPHAN_DOC_LIST_SELECT } from '../../utils/complianceImport'
import { deleteComplianceDocuments } from '../../utils/complianceDocumentDelete'
import LoadingSpinner from '../LoadingSpinner'
import { FileText, ChevronRight, X } from '../ui/Icons'

const DOC_SELECT = `id, file_name, processing_status, review_status, item_id, storage_path, bucket`

export default function ComplianceMobileQueue() {
  const { t } = useLanguage()
  const { error: showError, success } = useToast()
  const navigate = useNavigate()
  const [attention, setAttention] = useState([])
  const [failed, setFailed] = useState([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      const [orphanRes, failedRes] = await Promise.all([
        supabase
          .from('compliance_item_documents')
          .select(ORPHAN_DOC_LIST_SELECT)
          .is('item_id', null)
          .neq('processing_status', 'failed')
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('compliance_item_documents')
          .select(DOC_SELECT)
          .eq('processing_status', 'failed')
          .order('updated_at', { ascending: false })
          .limit(30),
      ])
      if (orphanRes.error) throw orphanRes.error
      if (failedRes.error) throw failedRes.error
      setAttention(orphanRes.data || [])
      setFailed(failedRes.data || [])
    } catch (err) {
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }, [showError])

  useEffect(() => {
    refresh()
    const ch = supabase
      .channel('compliance_mobile_queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compliance_item_documents' }, () => refresh())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [refresh])

  const openDoc = (doc) => {
    if (doc.item_id == null) {
      navigate(`/m/compliance/review-orphan/${doc.id}`)
    } else {
      navigate(`/compliance/item/${doc.id}`)
    }
  }

  const deleteAllFailed = async () => {
    if (!failed.length) return
    try {
      setDeleting(true)
      await deleteComplianceDocuments(failed)
      success(t('compliance.bulk.deleted_count', { count: failed.length }))
      refresh()
    } catch (err) {
      showError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="flex flex-col gap-4 max-w-lg mx-auto w-full pb-4">
      <section className="rounded-xl bg-white border border-amber-200 overflow-hidden">
        <header className="px-4 py-3 bg-amber-50 border-b border-amber-100">
          <h2 className="text-sm font-bold text-amber-900">{t('compliance.workflow.col_attention')}</h2>
        </header>
        {attention.length === 0 ? (
          <p className="text-sm text-gray-500 p-4 text-center">{t('compliance.workflow.empty_attention')}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {attention.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => openDoc(d)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-start hover:bg-gray-50"
                >
                  <FileText size={18} className="text-gray-400 flex-shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{d.file_name}</span>
                    <span className="text-[10px] text-amber-700">{t('compliance.import.review_orphan')}</span>
                  </span>
                  <ChevronRight size={16} className="text-gray-400" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {failed.length > 0 && (
        <section className="rounded-xl bg-white border border-red-200 overflow-hidden">
          <header className="px-4 py-3 bg-red-50 border-b border-red-100 flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-red-900">{t('compliance.bulk.failed_documents_title')}</h2>
            <button
              type="button"
              disabled={deleting}
              onClick={deleteAllFailed}
              className="text-xs text-red-700 font-medium"
            >
              {t('compliance.bulk.delete_all_failed')}
            </button>
          </header>
          <ul className="divide-y divide-gray-100">
            {failed.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <FileText size={18} className="text-red-400 flex-shrink-0" />
                <span className="flex-1 text-sm truncate">{d.file_name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
