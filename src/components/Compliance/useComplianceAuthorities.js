// Hook: load + subscribe to compliance_authorities (mirrors the realtime pattern
// used in Liabilities.jsx).
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

export function useComplianceAuthorities() {
  const [authorities, setAuthorities] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('compliance_authorities')
        .select('*')
        .order('name', { ascending: true })
      if (error) throw error
      setAuthorities(data || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const ch = supabase
      .channel('compliance_authorities_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compliance_authorities' }, () => fetchData())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [fetchData])

  return { authorities, loading, refresh: fetchData }
}

export function useComplianceCategories() {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('compliance_categories')
        .select('*')
        .order('is_system', { ascending: false })
        .order('name', { ascending: true })
      if (error) throw error
      setCategories(data || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { categories, loading, refresh: fetchData }
}