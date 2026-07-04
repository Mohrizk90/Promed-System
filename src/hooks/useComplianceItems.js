// Bridge file: re-export the existing Compliance item/authority hooks so
// hooks/ can be the canonical location for cross-module hooks.
export {
  useComplianceItems,
  useComplianceItem,
} from '../components/Compliance/useComplianceItems'

export {
  useComplianceAuthorities,
  useComplianceCategories,
} from '../components/Compliance/useComplianceAuthorities'