// Hook: load + subscribe to compliance_items, joined with authority + category
// for table display.
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

const ITEM_SELECT =
  '*, compliance_authorities:authority_id (id, name, code, color), ' +
  'compliance_categories:category_id (id, name, key)'

export function useComplianceItems() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('compliance_items')
        .select(ITEM_SELECT)
        .order('created_at', { ascending: false })
      if (err) throw err
      setItems(data || [])
      setError(null)
    } catch (err) {
      console.error('[useComplianceItems] load failed', err)
      setError(err.message || 'Failed to load compliance items')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const ch = supabase
      .channel('compliance_items_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compliance_items' }, () => fetchData())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [fetchData])

  return { items, loading, error, refresh: fetchData }
}

// Single-item hook used by the detail page.
export function useComplianceItem(itemId) {
  const [item, setItem] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    if (!itemId) return
    try {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('compliance_items')
        .select(ITEM_SELECT)
        .eq('id', itemId)
        .single()
      if (err) throw err
      setItem(data)
      setError(null)
    } catch (err) {
      console.error('[useComplianceItem] load failed', err)
      setError(err.message || 'Failed to load compliance item')
    } finally {
      setLoading(false)
    }
  }, [itemId])

  useEffect(() => {
    fetchData()
    if (!itemId) return
    const ch = supabase
      .channel(`compliance_item_${itemId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compliance_items', filter: `id=eq.${itemId}` }, () => fetchData())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [fetchData, itemId])

  return { item, loading, error, refresh: fetchData }
}