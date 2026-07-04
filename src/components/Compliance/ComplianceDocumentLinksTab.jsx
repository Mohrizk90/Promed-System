// Item-detail sub-tab: pick a document, show its links.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../context/LanguageContext'
import LoadingSpinner from '../LoadingSpinner'
import ComplianceDocumentLinksEditor from './ComplianceDocumentLinksEditor'
import { FileText } from '../ui/Icons'

export default function ComplianceDocumentLinksTab({ itemId }) {
  const { t } = useLanguage()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    if (!itemId) return undefined
    const load = async () => {
      try {
        setLoading(true)
        const { data, error } = await supabase
          .from('compliance_item_documents')
          .select('id, file_name, version, is_current_version, processing_status')
          .eq('item_id', itemId)
          .eq('is_current_version', true)
          .order('created_at', { ascending: false })
        if (error) throw error
        setDocs(data || [])
        if (!selected && data && data[0]) setSelected(data[0].id)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [itemId])

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="label text-xs">{t('common.selectDocument') || 'Document'}</label>
        <select
          className="input py-2 text-sm w-72"
          value={selected || ''}
          onChange={(e) => setSelected(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">— select —</option>
          {docs.map((d) => (
            <option key={d.id} value={d.id}>{d.file_name} (v{d.version})</option>
          ))}
        </select>
      </div>

      {!selected ? (
        <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed border-gray-200 rounded">
          <FileText size={32} className="text-gray-300 mb-2" />
          <p className="text-sm text-gray-500">Pick a document to manage its links.</p>
        </div>
      ) : (
        <ComplianceDocumentLinksEditor documentId={selected} />
      )}
    </div>
  )
}