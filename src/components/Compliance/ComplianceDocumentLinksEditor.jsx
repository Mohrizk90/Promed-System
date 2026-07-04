// Edit the polymorphic links for one document. Loads existing links for the
// given document and lets the user add/remove links to any of the six entity
// types defined in the SQL CHECK constraint.
import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { useLanguage } from '../../context/LanguageContext'
import { Tag, Plus, Trash2 } from '../ui/Icons'
import { LINK_ENTITY_TYPES } from '../../utils/documentProcessing'
import ConfirmDialog from '../ui/ConfirmDialog'

export default function ComplianceDocumentLinksEditor({ documentId }) {
  const { t } = useLanguage()
  const { user } = useAuth()
  const { success, error: showError } = useToast()
  const [links, setLinks] = useState([])
  const [loading, setLoading] = useState(true)
  const [entityType, setEntityType] = useState(LINK_ENTITY_TYPES[0])
  const [entityId, setEntityId] = useState('')
  const [linkRole, setLinkRole] = useState('related')
  const [adding, setAdding] = useState(false)
  const [removeTarget, setRemoveTarget] = useState(null)
  const [removing, setRemoving] = useState(false)

  const fetchLinks = async () => {
    if (!documentId) return
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('compliance_document_links')
        .select('*')
        .eq('document_id', documentId)
        .order('created_at', { ascending: true })
      if (error) throw error
      setLinks(data || [])
    } catch (err) {
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLinks()
    if (!documentId) return undefined
    const ch = supabase
      .channel(`compliance_doc_links_${documentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compliance_document_links', filter: `document_id=eq.${documentId}` }, () => fetchLinks())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [documentId])

  const handleAdd = async (e) => {
    e.preventDefault()
    const id = parseInt(entityId, 10)
    if (!id || isNaN(id)) { showError('entity_id is required'); return }
    try {
      setAdding(true)
      const { error } = await supabase.from('compliance_document_links').insert([{
        document_id: documentId,
        entity_type: entityType,
        entity_id: id,
        link_role: linkRole,
        user_id: user?.id || null,
      }])
      if (error) throw error
      success('Link added')
      setEntityId('')
    } catch (err) {
      showError(err.message)
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async () => {
    if (!removeTarget) return
    try {
      setRemoving(true)
      const { error } = await supabase.from('compliance_document_links').delete().eq('id', removeTarget.id)
      if (error) throw error
      success('Link removed')
      setRemoveTarget(null)
    } catch (err) {
      showError(err.message)
    } finally {
      setRemoving(false)
    }
  }

  if (!documentId) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed border-gray-200 rounded">
        <p className="text-sm text-gray-500">Pick a document first.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label text-xs">{t('compliance.documentLink.entity_type')}</label>
          <select className="input py-2 text-sm w-44 rounded-lg border-gray-300" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            {LINK_ENTITY_TYPES.map((et) => (
              <option key={et} value={et}>{t(`compliance.documentLink.entity_type_${et}`)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label text-xs">{t('compliance.documentLink.entity_id')}</label>
          <input type="number" min="1" className="input py-2 text-sm w-28" value={entityId} onChange={(e) => setEntityId(e.target.value)} required />
        </div>
        <div>
          <label className="label text-xs">{t('compliance.documentLink.link_role')}</label>
          <select className="input py-2 text-sm w-32 rounded-lg border-gray-300" value={linkRole} onChange={(e) => setLinkRole(e.target.value)}>
            <option value="related">{t('compliance.documentLink.role_related')}</option>
            <option value="primary">{t('compliance.documentLink.role_primary')}</option>
            <option value="copy">{t('compliance.documentLink.role_copy')}</option>
          </select>
        </div>
        <button type="submit" disabled={adding || !entityId} className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 px-4 rounded text-sm flex items-center gap-2 disabled:opacity-50">
          <Plus size={16} />
          {t('compliance.documentLink.add_link')}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-gray-500 py-3">{t('common.loading')}</p>
      ) : links.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed border-gray-200 rounded">
          <p className="text-sm text-gray-500">{t('compliance.documentLink.no_links')}</p>
        </div>
      ) : (
        <ul className="space-y-1">
          {links.map((l) => (
            <li key={l.id} className="flex items-center gap-2 py-2 px-3 border border-gray-200 rounded bg-white">
              <Tag size={16} className="text-gray-500" />
              <span className="inline px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700">
                {t(`compliance.documentLink.entity_type_${l.entity_type}`)}
              </span>
              <span className="font-mono text-sm text-gray-900">#{l.entity_id}</span>
              <span className="inline px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">
                {l.link_role}
              </span>
              <button
                type="button"
                onClick={() => setRemoveTarget(l)}
                className="ml-auto p-2 rounded text-red-600 hover:bg-red-50"
                title="Remove"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        isOpen={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemove}
        title={t('common.deleteConfirmTitle')}
        message={t('compliance.documentLink.delete_link_confirm')}
        confirmLabel={t('common.delete')}
        isLoading={removing}
        variant="danger"
      />
    </div>
  )
}