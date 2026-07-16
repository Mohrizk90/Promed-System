import { allocateNextInvoiceNumber, getInvoiceSettings } from './invoiceSettings.js'
import { getCompanySettings } from './companySettings.js'

const DRAFT_STATUSES = new Set(['not_started', 'in_progress'])

/** Draft = not yet issued (no invoice number and still in working status). */
export function isDraftInvoice(transaction) {
  if (!transaction) return false
  if (transaction.invoice_number) return false
  return DRAFT_STATUSES.has(transaction.status || 'not_started')
}

/** Issued = has an official invoice number assigned. */
export function isIssuedInvoice(transaction) {
  return Boolean(transaction?.invoice_number?.trim())
}

/** Customer-facing number when set; otherwise the internal system number. */
export function getDisplayInvoiceNumber(transaction) {
  const external = (transaction?.external_invoice_number || '').trim()
  if (external) return external
  return (transaction?.invoice_number || '').trim()
}

export function invoiceWorkflowStatus(transaction) {
  if (isIssuedInvoice(transaction)) return 'issued'
  if (isDraftInvoice(transaction)) return 'draft'
  return 'legacy'
}

/**
 * Build status + invoice number for save/issue.
 * @param {'draft'|'issue'|'save'} mode
 */
export function resolveInvoiceFields({ mode, formStatus, invoiceNumber, remainingAmount }) {
  const hasNumber = Boolean(invoiceNumber?.trim())

  if (mode === 'issue' && !hasNumber) {
    return {
      invoice_number: allocateNextInvoiceNumber(),
      status: remainingAmount <= 0 ? (formStatus === 'done' ? 'done' : 'paid') : 'invoice',
    }
  }

  if (mode === 'draft') {
    return {
      invoice_number: hasNumber ? invoiceNumber.trim() : null,
      status: DRAFT_STATUSES.has(formStatus) ? formStatus : 'not_started',
    }
  }

  return {
    invoice_number: hasNumber ? invoiceNumber.trim() : null,
    status: formStatus,
  }
}

export function buildInvoicePdfOptions(language, currency) {
  const company = getCompanySettings()
  const invoice = getInvoiceSettings()
  return {
    companyName: company.companyName,
    companyAddress: company.companyAddress,
    companyPhone: company.companyPhone,
    companyEmail: company.companyEmail,
    invoicePrefix: invoice.invoicePrefix,
    currency,
    language,
  }
}
