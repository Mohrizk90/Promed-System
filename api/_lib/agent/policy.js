// Smart confirm: which changes the agent may save on its own, and which wait for the owner.

export const DEFAULT_AUTO_SAVE_LIMIT = 5000

// New records only. Edits, deletes and undo always need the owner.
export const AUTO_KINDS = new Set([
  'record_entries', 'client_payment', 'supplier_payment', 'record_sale', 'record_purchase',
  'link_records', 'create_record', 'batch',
])

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** The money size of an operation, used against the auto-save limit. */
export function amountOf(kind, payload = {}, preview = null) {
  switch (kind) {
    case 'record_entries':
      return (payload.entries || []).reduce((s, e) => s + num(e.amount), 0)
    case 'client_payment':
    case 'supplier_payment':
      return num(payload.amount)
    case 'record_sale':
      return num(preview?.total) || (payload.lines || []).reduce((s, l) => s + num(l.quantity) * num(l.unit_price), 0)
    case 'record_purchase':
      return num(preview?.total) || num(payload.quantity) * num(payload.unit_price)
    case 'create_record':
      return num(payload.values?.total_amount ?? payload.values?.amount ?? payload.values?.payment_amount ?? payload.values?.budget)
    case 'batch':
      return (payload.operations || []).reduce((s, op, i) => s + amountOf(op.kind, op.payload, Array.isArray(preview) ? preview[i] : null), 0)
    default:
      return 0
  }
}

function hasDeleteOrUpdate(kind, payload) {
  if (kind === 'update_record' || kind === 'delete_record' || kind === 'unlink_records') return true
  if (kind === 'batch') return (payload?.operations || []).some((op) => hasDeleteOrUpdate(op.kind, op.payload))
  return false
}

/**
 * @returns {{save: boolean, reason: string}}
 */
export function decideAutoSave({ kind, payload, amount, confident = true, limit = DEFAULT_AUTO_SAVE_LIMIT }) {
  const lim = limit === null || limit === undefined ? DEFAULT_AUTO_SAVE_LIMIT : num(limit)
  if (hasDeleteOrUpdate(kind, payload)) return { save: false, code: 'edit', reason: 'edits and deletions always need your confirmation' }
  if (!AUTO_KINDS.has(kind)) return { save: false, code: 'kind', reason: 'this kind of change needs your confirmation' }
  if (kind === 'batch' && (payload?.operations || []).some((op) => !AUTO_KINDS.has(op.kind))) {
    return { save: false, code: 'kind', reason: 'this kind of change needs your confirmation' }
  }
  if (!confident) return { save: false, code: 'guess', reason: 'some details were a guess, please check them' }
  if (!(lim > 0)) return { save: false, code: 'off', reason: 'auto-save is turned off' }
  if (num(amount) >= lim) return { save: false, code: 'limit', reason: `EGP ${num(amount).toLocaleString('en-US')} is at or above your auto-save limit of EGP ${lim.toLocaleString('en-US')}` }
  return { save: true, code: 'ok', reason: `new entry under EGP ${lim.toLocaleString('en-US')}` }
}
