import jsPDF from 'jspdf'
import 'jspdf-autotable'

/* ───── Font cache (loaded once, reused) ───── */
let _fontCache = null

async function loadArabicFont() {
  if (_fontCache) return _fontCache
  try {
    const [regular, bold] = await Promise.all([
      fetch('/fonts/Amiri-Regular.ttf').then(r => r.arrayBuffer()),
      fetch('/fonts/Amiri-Bold.ttf').then(r => r.arrayBuffer()),
    ])
    _fontCache = {
      regular: arrayBufferToBase64(regular),
      bold: arrayBufferToBase64(bold),
    }
    return _fontCache
  } catch {
    return null
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode.apply(null, chunk)
  }
  return btoa(binary)
}

function registerFont(doc, fontData) {
  if (!fontData) return false
  doc.addFileToVFS('Amiri-Regular.ttf', fontData.regular)
  doc.addFont('Amiri-Regular.ttf', 'Amiri', 'normal')
  doc.addFileToVFS('Amiri-Bold.ttf', fontData.bold)
  doc.addFont('Amiri-Bold.ttf', 'Amiri', 'bold')
  return true
}

function parseDate(value) {
  if (!value) return null
  const str = String(value)
  return new Date(str.includes('T') ? str : `${str}T00:00:00`)
}

function isBefore(date, boundary) {
  const d = parseDate(date)
  const b = parseDate(boundary)
  if (!d || !b) return false
  return d < b
}

function isAfter(date, boundary) {
  const d = parseDate(date)
  const b = parseDate(boundary)
  if (!d || !b) return false
  return d > b
}

function inRange(date, dateFrom, dateTo) {
  if (dateFrom && isBefore(date, dateFrom)) return false
  if (dateTo && isAfter(date, dateTo)) return false
  return true
}

function compareDates(a, b) {
  const da = parseDate(a)?.getTime() ?? 0
  const db = parseDate(b)?.getTime() ?? 0
  return da - db
}

function sumInvoices(transactions) {
  return transactions.reduce((sum, tx) => sum + Number(tx.total_amount || 0), 0)
}

function sumPayments(payments) {
  return payments.reduce((sum, p) => sum + Number(p.payment_amount || 0), 0)
}

// Opening balance for the period = the client's carried-in opening balance
// (set once, rolls forward) plus real activity before the start date
// (prior invoices minus all prior payments, including account-level ones).
// With no start date the period opening is just the carried-in balance.
function computeOpeningBalance(transactions, payments, dateFrom, carriedOpeningBalance = 0) {
  const carried = Number(carriedOpeningBalance || 0)
  if (!dateFrom) return carried
  const priorTx = transactions.filter((tx) => isBefore(tx.transaction_date, dateFrom))
  const priorPayments = payments.filter((p) => isBefore(p.payment_date, dateFrom))
  return carried + sumInvoices(priorTx) - sumPayments(priorPayments)
}

/**
 * Build chronological ledger rows for a client statement.
 * @returns {Array<{date, type, invoiceNumber, wht, invAmount, payment, balance}>}
 */
export function buildStatementRows(transactions = [], payments = [], options = {}) {
  const { dateFrom = null, dateTo = null, openingBalance = 0 } = options

  const paymentsByTx = payments.reduce((map, payment) => {
    const id = payment.transaction_id
    if (!map[id]) map[id] = []
    map[id].push(payment)
    return map
  }, {})

  Object.values(paymentsByTx).forEach((list) => {
    list.sort((a, b) => compareDates(a.payment_date, b.payment_date))
  })

  const startBalance = computeOpeningBalance(transactions, payments, dateFrom, openingBalance)
  const rows = []
  let balance = startBalance

  if (startBalance !== 0) {
    rows.push({
      date: dateFrom || transactions[0]?.transaction_date || null,
      type: 'openingBalance',
      invoiceNumber: '',
      wht: '—',
      invAmount: startBalance > 0 ? startBalance : '',
      payment: startBalance < 0 ? Math.abs(startBalance) : '',
      balance: startBalance,
    })
  }

  const events = []
  const knownTxIds = new Set(transactions.map((tx) => tx.transaction_id))

  payments.forEach((payment) => {
    // Account-level payments (no transaction_id) AND orphan payments — those tied
    // to an invoice that isn't in this set (e.g. a deleted invoice) — are both
    // shown as account payments. Dropping orphans would understate money received
    // and leave the statement balance higher than the system's account balance.
    const isOrphan = payment.transaction_id != null && !knownTxIds.has(payment.transaction_id)
    if (payment.transaction_id == null || isOrphan) {
      if (inRange(payment.payment_date, dateFrom, dateTo)) {
        events.push({
          kind: 'accountPayment',
          date: payment.payment_date,
          payment,
          sortOrder: 1,
        })
      }
    }
  })

  transactions.forEach((tx) => {
    if (inRange(tx.transaction_date, dateFrom, dateTo)) {
      events.push({
        kind: 'invoice',
        date: tx.transaction_date,
        tx,
        sortOrder: 0,
      })
    }
    ;(paymentsByTx[tx.transaction_id] || []).forEach((payment) => {
      if (inRange(payment.payment_date, dateFrom, dateTo)) {
        events.push({
          kind: 'payment',
          date: payment.payment_date,
          payment,
          tx,
          sortOrder: 1,
        })
      }
    })
  })

  events.sort((a, b) => {
    const byDate = compareDates(a.date, b.date)
    if (byDate !== 0) return byDate
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return (a.tx?.transaction_id || 0) - (b.tx?.transaction_id || 0)
  })

  events.forEach((event) => {
    if (event.kind === 'invoice') {
      const amount = Number(event.tx.total_amount || 0)
      balance += amount
      rows.push({
        date: event.tx.transaction_date,
        type: 'invoice',
        invoiceNumber: event.tx.invoice_number || '',
        wht: '—',
        invAmount: amount,
        payment: '',
        balance,
      })
      return
    }

    const amount = Number(event.payment.payment_amount || 0)
    balance -= amount
    const isAccount = event.kind === 'accountPayment'
    rows.push({
      date: event.payment.payment_date,
      type: isAccount ? 'accountPayment' : 'payment',
      invoiceNumber: isAccount ? '' : (event.tx?.invoice_number || ''),
      wht: '—',
      invAmount: '',
      payment: amount,
      balance,
    })
  })

  return rows
}

/** Closing summary from ledger rows (negative balance = customer credit). */
export function getStatementClosingSummary(rows = []) {
  const closingBalance = rows.length > 0 ? rows[rows.length - 1].balance : 0
  return {
    closingBalance,
    amountDue: Math.max(0, closingBalance),
    creditBalance: Math.max(0, -closingBalance),
  }
}

export function formatStatementPeriod(dateFrom, dateTo) {
  const formatPart = (value, shortYear = false) => {
    const d = parseDate(value)
    if (!d) return ''
    const month = d.getMonth() + 1
    const year = d.getFullYear()
    return shortYear ? `${month} / ${String(year).slice(-2)}` : `${month} / ${year}`
  }

  if (dateFrom && dateTo) {
    return `${formatPart(dateFrom, false)} TO ${formatPart(dateTo, true)}`
  }
  if (dateFrom) return `${formatPart(dateFrom, false)} TO —`
  if (dateTo) return `— TO ${formatPart(dateTo, true)}`
  return 'All'
}

function fmt(n) {
  return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d) {
  if (!d) return '—'
  return parseDate(d)?.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) ?? '—'
}

function fmtTableDate(d) {
  if (!d) return '—'
  const dt = parseDate(d)
  if (!dt) return '—'
  return dt.toLocaleDateString('en-GB')
}

const labels = {
  en: {
    statement: 'Statement',
    statementNumber: 'Statement #',
    date: 'Date',
    billTo: 'Bill To',
    companyName: 'Company Name',
    colDate: 'Date',
    colType: 'Type',
    colInv: 'Inv. #',
    colWht: 'WHT',
    colInvAmount: 'INV. Amount',
    colPayment: 'Payment',
    colBalance: 'Balance',
    openingBalance: 'OPENING BALANCE',
    invoice: 'Invoice',
    payment: 'Payment',
    closingBalance: 'Closing Balance',
    noActivity: 'No activity in this period',
    generatedBy: 'Generated by Promed',
  },
  ar: {
    statement: 'كشف حساب',
    statementNumber: 'رقم الكشف',
    date: 'التاريخ',
    billTo: 'فاتورة إلى',
    companyName: 'اسم الشركة',
    colDate: 'التاريخ',
    colType: 'النوع',
    colInv: 'رقم الفاتورة',
    colWht: 'خصم',
    colInvAmount: 'مبلغ الفاتورة',
    colPayment: 'الدفعة',
    colBalance: 'الرصيد',
    openingBalance: 'رصيد افتتاحي',
    invoice: 'فاتورة',
    payment: 'دفعة',
    closingBalance: 'الرصيد الختامي',
    noActivity: 'لا توجد حركة في هذه الفترة',
    generatedBy: 'Promed تم الإنشاء بواسطة',
  },
}

const COLORS = {
  primary: [30, 64, 175],
  primaryLight: [59, 130, 246],
  white: [255, 255, 255],
  text: [17, 24, 39],
  muted: [107, 114, 128],
  light: [243, 244, 246],
  border: [209, 213, 219],
  header: [55, 65, 81],
}

/**
 * Generate a professional client account statement PDF.
 */
export async function generateStatement({ client, transactions = [], payments = [], options = {} }) {
  const {
    companyName = 'Promed',
    companyAddress = '',
    companyPhone = '',
    companyEmail = '',
    companyTagline = '',
    currency = 'EGP',
    language = 'en',
    dateFrom = null,
    dateTo = null,
    openingBalance = 0,
  } = options

  const isAr = language === 'ar'
  const L = labels[isAr ? 'ar' : 'en']
  const fontData = await loadArabicFont()
  const doc = new jsPDF({ putOnlyUsedFonts: true })
  const hasFont = registerFont(doc, fontData)
  const fontFamily = hasFont ? 'Amiri' : 'helvetica'

  const setFont = (style = 'normal', size = 10) => {
    doc.setFont(fontFamily, style)
    doc.setFontSize(size)
  }

  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const marginL = 20
  const marginR = 20
  const contentW = pw - marginL - marginR
  const rX = pw - marginR

  const fmtCur = (n) => {
    if (n === '' || n == null) return ''
    const val = fmt(n)
    return isAr ? `${val} ${currency}` : `${currency} ${val}`
  }

  const clientName = client?.client_name || '—'
  const statementRows = buildStatementRows(transactions, payments, { dateFrom, dateTo, openingBalance })
  const statementPeriod = formatStatementPeriod(dateFrom, dateTo)
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  const typeLabel = (type) => {
    if (type === 'openingBalance') return L.openingBalance
    if (type === 'invoice') return L.invoice
    if (type === 'payment') return L.payment
    return type
  }

  /* Header bar */
  doc.setFillColor(...COLORS.primary)
  doc.rect(0, 0, pw, 40, 'F')
  doc.setFillColor(...COLORS.primaryLight)
  doc.rect(0, 40, pw, 2, 'F')

  doc.setTextColor(...COLORS.white)
  setFont('bold', 20)
  doc.text(companyName, pw / 2, 16, { align: 'center' })

  setFont('normal', 9)
  const contactLine = [companyAddress, companyPhone, companyEmail].filter(Boolean).join('  ·  ')
  if (contactLine) {
    doc.text(contactLine, pw / 2, 24, { align: 'center' })
  }
  if (companyTagline) {
    doc.text(companyTagline, pw / 2, 31, { align: 'center' })
  }

  let y = 52

  doc.setTextColor(...COLORS.text)
  setFont('bold', 16)
  doc.text(`${L.statement} ${companyName} - ${clientName}`, pw / 2, y, { align: 'center' })

  y += 4
  doc.setDrawColor(...COLORS.border)
  doc.setLineWidth(0.4)
  doc.line(marginL, y, pw - marginR, y)

  y += 12
  setFont('normal', 10)
  doc.setTextColor(...COLORS.text)
  doc.text(`${L.statementNumber}: ${statementPeriod}`, marginL, y)
  doc.text(`${L.date}: ${today}`, marginL, y + 7)

  doc.setTextColor(...COLORS.muted)
  setFont('bold', 9)
  doc.text(L.billTo, rX, y, { align: 'right' })
  doc.setTextColor(...COLORS.text)
  setFont('bold', 11)
  doc.text(clientName, rX, y + 7, { align: 'right' })
  setFont('normal', 9)
  doc.text(`${L.companyName}: ${clientName}`, rX, y + 14, { align: 'right' })
  if (client?.address) {
    doc.text(client.address, rX, y + 21, { align: 'right' })
  }
  if (client?.contact_info) {
    doc.text(client.contact_info, rX, y + 28, { align: 'right' })
  }

  y += 38

  const tableHead = isAr
    ? [[L.colBalance, L.colPayment, L.colInvAmount, L.colWht, L.colInv, L.colType, L.colDate]]
    : [[L.colDate, L.colType, L.colInv, L.colWht, L.colInvAmount, L.colPayment, L.colBalance]]

  const tableBody = statementRows.length === 0
    ? (isAr
      ? [['—', '—', '—', '—', '—', L.noActivity, '—']]
      : [['—', L.noActivity, '—', '—', '—', '—', '—']])
    : statementRows.map((row) => {
      const cells = [
        fmtTableDate(row.date),
        typeLabel(row.type),
        row.invoiceNumber || '—',
        row.wht || '—',
        row.invAmount !== '' ? fmtCur(row.invAmount) : '',
        row.payment !== '' ? fmtCur(row.payment) : '',
        fmtCur(row.balance),
      ]
      return isAr ? cells.reverse() : cells
    })

  doc.autoTable({
    startY: y,
    head: tableHead,
    body: tableBody,
    theme: 'grid',
    headStyles: {
      fillColor: COLORS.header,
      textColor: COLORS.white,
      fontStyle: 'bold',
      fontSize: 9,
      cellPadding: { top: 4, bottom: 4, left: 4, right: 4 },
      font: fontFamily,
    },
    bodyStyles: {
      fontSize: 9,
      cellPadding: { top: 4, bottom: 4, left: 4, right: 4 },
      textColor: COLORS.text,
      font: fontFamily,
    },
    alternateRowStyles: {
      fillColor: COLORS.light,
    },
    styles: {
      lineColor: COLORS.border,
      lineWidth: 0.2,
      font: fontFamily,
      halign: isAr ? 'right' : 'left',
      overflow: 'linebreak',
    },
    columnStyles: isAr
      ? {
          0: { halign: 'right', cellWidth: 28 },
          1: { halign: 'right', cellWidth: 24 },
          2: { halign: 'right', cellWidth: 24 },
          3: { halign: 'center', cellWidth: 14 },
          4: { halign: 'center', cellWidth: 18 },
          5: { halign: 'right' },
          6: { halign: 'center', cellWidth: 22 },
        }
      : {
          0: { halign: 'center', cellWidth: 22 },
          1: { halign: 'left' },
          2: { halign: 'center', cellWidth: 18 },
          3: { halign: 'center', cellWidth: 14 },
          4: { halign: 'right', cellWidth: 24 },
          5: { halign: 'right', cellWidth: 24 },
          6: { halign: 'right', cellWidth: 28 },
        },
    margin: { left: marginL, right: marginR },
    tableWidth: contentW,
  })

  y = doc.lastAutoTable.finalY + 10

  const closingBalance = statementRows.length > 0
    ? statementRows[statementRows.length - 1].balance
    : computeOpeningBalance(transactions, payments, dateFrom, openingBalance)

  if (y > ph - 40) {
    doc.addPage()
    y = 20
  }

  doc.setFillColor(...COLORS.light)
  doc.roundedRect(isAr ? marginL : pw - marginR - 90, y, 90, 16, 2, 2, 'F')
  doc.setTextColor(...COLORS.text)
  setFont('bold', 11)
  doc.text(L.closingBalance, isAr ? marginL + 6 : pw - marginR - 84, y + 10)
  doc.text(fmtCur(closingBalance), isAr ? marginL + 84 : pw - marginR - 6, y + 10, { align: 'right' })

  const footerY = ph - 15
  doc.setDrawColor(...COLORS.border)
  doc.line(marginL, footerY - 6, pw - marginR, footerY - 6)
  doc.setTextColor(...COLORS.muted)
  setFont('normal', 8)
  doc.text(L.generatedBy, pw / 2, footerY, { align: 'center' })

  const safeName = clientName.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'client'
  const fileName = `statement-${safeName}-${new Date().toISOString().slice(0, 10)}.pdf`
  doc.save(fileName)
  return fileName
}
