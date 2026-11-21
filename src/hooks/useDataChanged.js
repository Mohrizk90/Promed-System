import { useEffect, useRef } from 'react'
import { DATA_CHANGED_EVENT } from '../lib/agentApi'

/** Calls `reload` whenever the agent (or anything else) announces that data changed. */
export function useDataChanged(reload) {
  const ref = useRef(reload)
  ref.current = reload
  useEffect(() => {
    let timer = 0
    const handler = () => {
      clearTimeout(timer)
      timer = setTimeout(() => ref.current?.(), 250)
    }
    window.addEventListener(DATA_CHANGED_EVENT, handler)
    return () => {
      clearTimeout(timer)
      window.removeEventListener(DATA_CHANGED_EVENT, handler)
    }
  }, [])
}

export default useDataChanged
