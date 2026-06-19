export const VAT_RATE = 14
export const WHT_RATE_OPTIONS = [0, 1, 3]

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

/**
 * Compute invoice tax breakdown from a subtotal.
 * - VAT is added on top of the subtotal (default 14%).
 * - Withholding tax (WHT) is calculated on the subtotal and deducted from
 *   what the client pays (the client remits it to the tax authority).
 *
 * netTotal = subtotal + VAT - WHT
 */
export function computeInvoiceTax(subtotal, whtRate = 0, vatRate = VAT_RATE) {
  const sub = round2(subtotal)
  const vRate = Number(vatRate) || 0
  const wRate = Number(whtRate) || 0
  const vatAmount = round2(sub * vRate / 100)
  const whtAmount = round2(sub * wRate / 100)
  const netTotal = round2(sub + vatAmount - whtAmount)
  return {
    subtotal: sub,
    vatRate: vRate,
    vatAmount,
    whtRate: wRate,
    whtAmount,
    netTotal,
  }
}
