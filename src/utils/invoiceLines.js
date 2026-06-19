import { isDraftInvoice, isIssuedInvoice } from './invoiceService'

export function emptyInvoiceLine() {
  return {
    product_id: '',
    product_name: '',
    item_code: '',
    unit_type: 'EA',
    quantity: '1',
    unit_price: '',
    line_total: '',
  }
}

export function calcLineTotal(quantity, unitPrice) {
  const q = Number(quantity)
  const p = Number(unitPrice)
  if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0) return 0
  return Math.round(q * p * 100) / 100
}

/** Normalize stored line_items from DB or form rows. */
export function normalizeInvoiceLines(raw = []) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((line) => ({
      product_id: line.product_id ?? '',
      product_name: String(line.product_name || '').trim(),
      item_code: String(line.item_code || '').trim(),
      unit_type: String(line.unit_type || '').trim() || 'EA',
      quantity: Number(line.quantity) || 0,
      unit_price: Number(line.unit_price) || 0,
      line_total: Number(line.line_total) || calcLineTotal(line.quantity, line.unit_price),
    }))
    .filter((line) => line.product_name && line.quantity > 0)
}

/**
 * Build all printable lines: primary row columns + JSON line_items.
 */
export function getInvoiceLinesFromTransaction(transaction) {
  if (!transaction) return []
  const primary = {
    product_id: transaction.product_id,
    product_name: transaction.products?.product_name || 'Product / Service',
    model: transaction.products?.model || '',
    item_code: transaction.eta_item_code || transaction.products?.eta_item_code || '',
    unit_type: transaction.eta_unit_type || transaction.products?.eta_unit_type || 'EA',
    quantity: Number(transaction.quantity) || 0,
    unit_price: Number(transaction.unit_price ?? 0),
    line_total: Number(transaction.total_amount) || 0,
  }
  if (primary.quantity > 0 && primary.product_name) {
    primary.line_total = calcLineTotal(primary.quantity, primary.unit_price) || primary.line_total
  }

  const extras = normalizeInvoiceLines(transaction.line_items)
  if (extras.length === 0) {
    return primary.quantity > 0 ? [primary] : []
  }

  return [
    {
      ...primary,
      line_total: calcLineTotal(primary.quantity, primary.unit_price) || primary.line_total,
    },
    ...extras,
  ]
}

export function sumInvoiceLines(lines = []) {
  return lines.reduce((sum, line) => sum + Number(line.line_total || 0), 0)
}

export function buildLineItemsPayload(primaryLine, extraLines = []) {
  const primaryTotal = calcLineTotal(primaryLine.quantity, primaryLine.unit_price)
  const extras = extraLines
    .filter((line) => line.product_name?.trim())
    .map((line) => ({
      product_id: line.product_id ? Number(line.product_id) : null,
      product_name: line.product_name.trim(),
      item_code: String(line.item_code || '').trim(),
      unit_type: String(line.unit_type || '').trim() || 'EA',
      quantity: Number(line.quantity) || 0,
      unit_price: Number(line.unit_price) || 0,
      line_total: calcLineTotal(line.quantity, line.unit_price),
    }))
    .filter((line) => line.quantity > 0)

  return {
    primaryTotal,
    extras,
    invoiceTotal: primaryTotal + sumInvoiceLines(extras),
  }
}

export function invoicePaymentStatus(transaction) {
  if (isDraftInvoice(transaction)) return 'draft'
  if (!isIssuedInvoice(transaction)) return 'legacy'
  const remaining = Number(transaction?.remaining_amount || 0)
  const paid = Number(transaction?.paid_amount || 0)
  if (remaining <= 0) return 'paid'
  if (paid > 0) return 'partial'
  return 'unpaid'
}

export function filterInvoicesByStatus(transactions = [], statusFilter = 'all') {
  const invoiceRows = transactions.filter(
    (tx) => isIssuedInvoice(tx) || isDraftInvoice(tx) || tx.status === 'invoice'
  )
  if (statusFilter === 'all') return invoiceRows
  if (statusFilter === 'issued') {
    return invoiceRows.filter((tx) => isIssuedInvoice(tx))
  }
  return invoiceRows.filter((tx) => invoicePaymentStatus(tx) === statusFilter)
}
