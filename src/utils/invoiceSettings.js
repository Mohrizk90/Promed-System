const STORAGE_KEYS = {
  invoicePrefix: 'invoicePrefix',
  invoiceNextNumber: 'invoiceNextNumber',
  invoicePadWidth: 'invoicePadWidth',
}

const DEFAULTS = {
  invoicePrefix: 'INV',
  invoiceNextNumber: 1,
  invoicePadWidth: 5,
}

function readInt(key, fallback) {
  const raw = localStorage.getItem(STORAGE_KEYS[key])
  if (raw == null || raw === '') return fallback
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function getInvoiceSettings() {
  const prefix = (localStorage.getItem(STORAGE_KEYS.invoicePrefix) || DEFAULTS.invoicePrefix).trim() || DEFAULTS.invoicePrefix
  return {
    invoicePrefix: prefix,
    nextNumber: readInt('invoiceNextNumber', DEFAULTS.invoiceNextNumber),
    padWidth: readInt('invoicePadWidth', DEFAULTS.invoicePadWidth),
  }
}

export function saveInvoiceSettings(settings) {
  const prefix = (settings.invoicePrefix ?? DEFAULTS.invoicePrefix).trim() || DEFAULTS.invoicePrefix
  const nextNumber = Math.max(1, parseInt(settings.nextNumber, 10) || DEFAULTS.invoiceNextNumber)
  const padWidth = Math.min(8, Math.max(3, parseInt(settings.padWidth, 10) || DEFAULTS.invoicePadWidth))
  localStorage.setItem(STORAGE_KEYS.invoicePrefix, prefix)
  localStorage.setItem(STORAGE_KEYS.invoiceNextNumber, String(nextNumber))
  localStorage.setItem(STORAGE_KEYS.invoicePadWidth, String(padWidth))
}

export function formatInvoiceNumber(prefix, sequence, padWidth = DEFAULTS.invoicePadWidth) {
  return `${prefix}-${String(sequence).padStart(padWidth, '0')}`
}

export function peekNextInvoiceNumber() {
  const { invoicePrefix, nextNumber, padWidth } = getInvoiceSettings()
  return formatInvoiceNumber(invoicePrefix, nextNumber, padWidth)
}

export function allocateNextInvoiceNumber() {
  const settings = getInvoiceSettings()
  const formatted = formatInvoiceNumber(settings.invoicePrefix, settings.nextNumber, settings.padWidth)
  saveInvoiceSettings({ ...settings, nextNumber: settings.nextNumber + 1 })
  return formatted
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Parse sequence from invoice numbers like INV-00042 */
export function parseInvoiceSequence(invoiceNumber, prefix) {
  if (!invoiceNumber || !prefix) return null
  const re = new RegExp(`^${escapeRegex(prefix)}-(\\d+)$`, 'i')
  const match = String(invoiceNumber).trim().match(re)
  if (!match) return null
  const seq = parseInt(match[1], 10)
  return Number.isFinite(seq) ? seq : null
}

/** Bump stored counter if existing invoices already use higher numbers. */
export function syncInvoiceCounterFromNumbers(invoiceNumbers = []) {
  const settings = getInvoiceSettings()
  let maxSeq = settings.nextNumber - 1
  for (const num of invoiceNumbers) {
    const seq = parseInvoiceSequence(num, settings.invoicePrefix)
    if (seq != null && seq > maxSeq) maxSeq = seq
  }
  if (maxSeq >= settings.nextNumber) {
    saveInvoiceSettings({ ...settings, nextNumber: maxSeq + 1 })
  }
}
