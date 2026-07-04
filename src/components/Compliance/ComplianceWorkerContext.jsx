import { createContext, useContext } from 'react'

export const ComplianceWorkerContext = createContext({ busy: false, lastResult: null })

export function useComplianceWorkerStatus() {
  return useContext(ComplianceWorkerContext)
}
