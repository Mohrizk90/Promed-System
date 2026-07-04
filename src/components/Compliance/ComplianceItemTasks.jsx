// Per-item task checklist. Standalone (not shared with other modules), per
// the user's choice. UI mirrors the inline list style used by Liabilities
// for payments, and emits a 'task_completed' / 'task_added' event into the
// timeline table so the activity log stays consistent.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { useLanguage } from '../../context/LanguageContext'
import EmptyState from '../ui/EmptyState'
import ConfirmDialog from '../ui/ConfirmDialog'
import Dropdown from '../ui/Dropdown'
import { Plus, MoreVertical, Trash2 } from '../ui/Icons'

export default function ComplianceItemTasks({ itemId }) {
  const { t } = useLanguage()
  const { user } = useAuth()
  const { success, error: showError } = useToast()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [newDue, setNewDue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const fetchTasks = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('compliance_item_tasks')
        .select('*')
        .eq('item_id', itemId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
      if (error) throw error
      setTasks(data || [])
    } catch (err) {
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!itemId) return
    fetchTasks()
    const ch = supabase
      .channel(`compliance_tasks_${itemId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compliance_item_tasks', filter: `item_id=eq.${itemId}` }, () => fetchTasks())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [itemId])

  const logEvent = async (eventType, payload) => {
    try {
      await supabase.from('compliance_item_events').insert([{
        item_id: itemId,
        event_type: eventType,
        actor_email: user?.email || null,
        payload,
      }])
    } catch (_) { /* timeline logging is best-effort */ }
  }

  const handleAdd = async (e) => {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title) return
    try {
      setSubmitting(true)
      const sort_order = (tasks[tasks.length - 1]?.sort_order || 0) + 10
      const { error } = await supabase.from('compliance_item_tasks').insert([{
        item_id: itemId,
        title,
        is_done: false,
        due_date: newDue || null,
        sort_order,
        user_id: user?.id || null,
      }])
      if (error) throw error
      await logEvent('task_added', { title })
      success(t('compliance.task_created'))
      setNewTitle('')
      setNewDue('')
    } catch (err) {
      showError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const toggleDone = async (task) => {
    try {
      const next = !task.is_done
      const patch = {
        is_done: next,
        completed_at: next ? new Date().toISOString() : null,
        completed_by_email: next ? (user?.email || null) : null,
      }
      const { error } = await supabase.from('compliance_item_tasks').update(patch).eq('id', task.id)
      if (error) throw error
      if (next) {
        await logEvent('task_completed', { title: task.title, task_id: task.id })
      }
    } catch (err) {
      showError(err.message)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      setDeleting(true)
      const { error } = await supabase.from('compliance_item_tasks').delete().eq('id', deleteTarget.id)
      if (error) throw error
      success(t('compliance.task_deleted'))
      setDeleteTarget(null)
    } catch (err) {
      showError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <p className="text-sm text-gray-500 py-4">{t('common.loading')}</p>

  return (
    <div className="space-y-3">
      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[220px]">
          <label className="label text-xs">{t('compliance.addTask')}</label>
          <input
            type="text"
            className="input w-full py-2 text-sm"
            placeholder={t('compliance.addTaskPlaceholder')}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
        </div>
        <div>
          <label className="label text-xs">{t('compliance.taskDueDate')}</label>
          <input
            type="date"
            className="input py-2 text-sm"
            value={newDue}
            onChange={(e) => setNewDue(e.target.value)}
          />
        </div>
        <button
          type="submit"
          disabled={!newTitle.trim() || submitting}
          className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 px-4 rounded text-sm flex items-center gap-2 disabled:opacity-50"
        >
          <Plus size={16} />
          {t('compliance.addTask')}
        </button>
      </form>

      {tasks.length === 0 ? (
        <EmptyStateCompact message={t('compliance.noTasks')} />
      ) : (
        <ul className="space-y-1">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2 py-2 px-3 bg-white border border-gray-200 rounded hover:bg-gray-50">
              <input
                type="checkbox"
                checked={!!task.is_done}
                onChange={() => toggleDone(task)}
                className="rounded border-gray-400 text-rose-600 focus:ring-rose-500 w-4 h-4"
                aria-label={task.title}
              />
              <div className="flex-1 min-w-0">
                <span className={`text-sm ${task.is_done ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                  {task.title}
                </span>
                <div className="flex items-center gap-2 text-[11px] text-gray-500">
                  {task.due_date && <span>{t('compliance.taskDueDate')}: {task.due_date}</span>}
                  {task.is_done && task.completed_at && (
                    <span className="text-green-700">{t('compliance.taskCompleted')}</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => toggleDone(task)}
                className="text-xs text-rose-700 hover:underline whitespace-nowrap"
              >
                {task.is_done ? t('compliance.markUndone') : t('compliance.markDone')}
              </button>
              <Dropdown
                trigger={<MoreVertical size={18} />}
                align="right"
                className="inline-block"
                items={[
                  { label: t('common.delete'), icon: Trash2, danger: true, onClick: () => setDeleteTarget(task) },
                ]}
              />
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t('common.deleteConfirmTitle')}
        message={t('compliance.deleteTaskConfirm')}
        confirmLabel={t('common.delete')}
        isLoading={deleting}
        variant="danger"
      />
    </div>
  )
}

function EmptyStateCompact({ message }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed border-gray-200 rounded">
      <p className="text-sm text-gray-500">{message}</p>
    </div>
  )
}