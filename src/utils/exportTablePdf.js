import jsPDFImport from 'jspdf'
import 'jspdf-autotable'
import { loadArabicFont, registerFont, savePdfBytes } from './generateStatement.js'

const jsPDF = jsPDFImport?.default ?? jsPDFImport.jsPDF ?? jsPDFImport

export function prettyHeader(col) {
  return String(col).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function formatCell(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (typeof v === 'object') return JSON.stringify(v)
  if (/^-?\d+(\.\d+)?$/.test(String(v)) && String(v).length < 16) return Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })
  return String(v)
}

/** Any table from the agent -> landscape PDF with the Promed header (Arabic-capable font). */
export async function exportTablePdf(title, columns, rows) {
  const doc = new jsPDF({ orientation: columns.length > 5 ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
  const hasFont = registerFont(doc, await loadArabicFont())
  const font = hasFont ? 'Amiri' : 'helvetica'
  doc.setFont(font, 'bold')
  doc.setFontSize(15)
  doc.text(title, 14, 16)
  doc.setFont(font, 'normal')
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text(`Promed · ${new Date().toLocaleString('en-GB')} · ${rows.length} rows`, 14, 22)
  doc.autoTable({
    startY: 27,
    head: [columns.map(prettyHeader)],
    body: rows.map((r) => columns.map((c) => formatCell(r[c]))),
    styles: { font, fontSize: 8.5, cellPadding: 1.8 },
    headStyles: { fillColor: [29, 78, 216], textColor: 255, font, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [241, 245, 255] },
    margin: { left: 10, right: 10 },
  })
  const safe = title.replace(/[^\w؀-ۿ -]+/g, '').trim().replace(/\s+/g, '_') || 'promed'
  savePdfBytes(doc.output('arraybuffer'), `${safe}.pdf`)
}
