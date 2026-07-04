// Item-detail sub-tab: pick a document, manage its tags.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { useLanguage } from '../../context/LanguageContext'
import LoadingSpinner from '../LoadingSpinner'
import ConfirmDialog from '../ui/ConfirmDialog'
import { useComplianceDocumentTags } from '../../hooks/useComplianceDocuments'
import { Tag, Plus, X, FileText } from '../ui/Icons'

export default function ComplianceDocumentTagsTab({ itemId }) {
  const { t } = useLanguage()
  const { user } = useAuth()
  const { success, error: showError } = useToast()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [assignments, setAssignments] = useState([])
  const [newTagName, setNewTagName] = useState('')
  const [creating, setCreating] = useState(false)
  const [tagToDelete, setTagToDelete] = useState(null)
  const [deletingTag, setDeletingTag] = useState(false)
  const { tags, refresh: refreshTags } = useComplianceDocumentTags()

  useEffect(() => {
    if (!itemId) return undefined
    const load = async () => {
      try {
        setLoading(true)
        const { data, error } = await supabase
          .from('compliance_item_documents')
          .select('id, file_name, version, is_current_version')
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

  const fetchAssignments = async () => {
    if (!selected) { setAssignments([]); return }
    const { data, error } = await supabase
      .from('compliance_document_tag_assignments')
      .select('tag_id, compliance_document_tags ( id, name )')
      .eq('document_id', selected)
    if (!error) setAssignments(data || [])
  }
  useEffect(() => { fetchAssignments() }, [selected])

  const assignedTagIds = useMemo(() => new Set(assignments.map((a) => a.tag_id)), [assignments])

  const handleCreate = async (e) => {
    e.preventDefault()
    const name = newTagName.trim()
    if (!name) return
    try {
      setCreating(true)
      const { error } = await supabase.from('compliance_document_tags').insert([{ name, user_id: user?.id || null }])
      if (error) throw error
      setNewTagName('')
      await refreshTags()
    } catch (err) {
      showError(err.message)
    } finally {
      setCreating(false)
    }
  }

  const handleToggle = async (tag) => {
    if (!selected) return
    try {
      if (assignedTagIds.has(tag.id)) {
        const { error } = await supabase
          .from('compliance_document_tag_assignments')
          .delete()
          .eq('document_id', selected)
          .eq('tag_id', tag.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('compliance_document_tag_assignments')
          .insert([{ document_id: selected, tag_id: tag.id, user_id: user?.id || null }])
        if (error) throw error
      }
      await fetchAssignments()
    } catch (err) {
      showError(err.message)
    }
  }

  const handleDeleteTag = async () => {
    if (!tagToDelete) return
    try {
      setDeletingTag(true)
      const { error } = await supabase.from('compliance_document_tags').delete().eq('id', tagToDelete.id)
      if (error) throw error
      await refreshTags()
      await fetchAssignments()
      success(t('compliance.documentTag.tag_deleted'))
    } catch (err) {
      showError(err.message)
    } finally {
      setDeletingTag(false)
      setTagToDelete(null)
    }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="label text-xs">{t('compliance.documentTag.document_label')}</label>
        <select
          className="input py-2 text-sm w-72"
          value={selected || ''}
          onChange={(e) => setSelected(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">{t('compliance.documentTag.select_placeholder')}</option>
          {docs.map((d) => (
            <option key={d.id} value={d.id}>{d.file_name} (v{d.version})</option>
          ))}
        </select>
      </div>

      {selected ? (
        <>
          <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[220px]">
              <label className="label text-xs">{t('compliance.documentTag.new_tag_placeholder')}</label>
              <input
                type="text"
                className="input w-full py-2 text-sm"
                placeholder={t('compliance.documentTag.new_tag_placeholder')}
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
              />
            </div>
            <button type="submit" disabled={creating || !newTagName.trim()} className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 px-4 rounded text-sm flex items-center gap-2 disabled:opacity-50">
              <Plus size={16} /> {t('compliance.documentTag.add_tag')}
            </button>
          </form>

          {tags.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed border-gray-200 rounded">
              <Tag size={32} className="text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">{t('compliance.documentTag.no_tags')}</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tg) => {
                const assigned = assignedTagIds.has(tg.id)
                return (
                  <span
                    key={tg.id}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-sm border ${assigned ? 'bg-rose-100 text-rose-800 border-rose-300' : 'bg-gray-50 text-gray-700 border-gray-200'}`}
                  >
                    <button
                      type="button"
                      onClick={() => handleToggle(tg)}
                      className="hover:underline"
                    >
                      {tg.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => setTagToDelete(tg)}
                      className="p-0.5 rounded-full hover:bg-red-100 text-red-600"
                      title={t('compliance.documentTag.delete_tag')}
                      aria-label={t('compliance.documentTag.delete_tag')}
                    >
                      <X size={12} />
                    </button>
                  </span>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed border-gray-200 rounded">
          <FileText size={32} className="text-gray-300 mb-2" />
          <p className="text-sm text-gray-500">{t('compliance.documentTag.pick_document_first')}</p>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!tagToDelete}
        onClose={() => setTagToDelete(null)}
        onConfirm={handleDeleteTag}
        title={t('compliance.documentTag.delete_tag')}
        message={t('compliance.documentTag.delete_tag_confirm')}
        confirmLabel={t('compliance.documentTag.delete_tag')}
        isLoading={deletingTag}
        variant="danger"
      />
    </div>
  )
}