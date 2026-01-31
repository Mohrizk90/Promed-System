import jsPDF from 'jspdf'
import 'jspdf-autotable'

/**
 * Generate a PDF invoice for a transaction
 * @param {Object} transaction - The transaction data
 * @param {Object} options - Optional settings
 */
export function generateInvoice(transaction, options = {}) {
  const {
    companyName = 'Promed',
    companyAddress = '',
    companyPhone = '',
    companyEmail = '',
    invoicePrefix = 'INV',
    currency = '$',
    language = 'en',
  } = options

  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()

  // Colors
  const primaryColor = [37, 99, 235] // Blue-600
  const textColor = [17, 24, 39] // Gray-900
  const mutedColor = [107, 114, 128] // Gray-500

  // Header
  doc.setFillColor(...primaryColor)
  doc.rect(0, 0, pageWidth, 40, 'F')

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(28)
  doc.setFont('helvetica', 'bold')
  doc.text(companyName, 20, 28)

  // Invoice title
  doc.setFontSize(12)
  doc.setFont('helvetica', 'normal')
  doc.text('INVOICE', pageWidth - 20, 20, { align: 'right' })

  const invoiceNumber = `${invoicePrefix}-${String(transaction.transaction_id).padStart(5, '0')}`
  doc.setFontSize(10)
  doc.text(invoiceNumber, pageWidth - 20, 28, { align: 'right' })

  // Reset text color
  doc.setTextColor(...textColor)

  // Invoice details section
  let yPos = 55

  // Bill To
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Bill To:', 20, yPos)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...mutedColor)
  
  const clientName = transaction.clients?.client_name || transaction.suppliers?.supplier_name || 'N/A'
  const contactInfo = transaction.clients?.contact_info || transaction.suppliers?.contact_info || ''
  
  yPos += 7
  doc.setTextColor(...textColor)
  doc.text(clientName, 20, yPos)
  
  if (contactInfo) {
    yPos += 5
    doc.setTextColor(...mutedColor)
    doc.text(contactInfo, 20, yPos)
  }

  // Invoice Info (right side)
  const rightCol = pageWidth - 60
  yPos = 55

  doc.setTextColor(...mutedColor)
  doc.setFontSize(9)
  doc.text('Invoice Date:', rightCol, yPos)
  doc.text('Due Date:', rightCol, yPos + 7)
  doc.text('Status:', rightCol, yPos + 14)

  doc.setTextColor(...textColor)
  doc.setFont('helvetica', 'normal')
  const invoiceDate = new Date(transaction.transaction_date).toLocaleDateString()
  const dueDate = new Date(transaction.transaction_date)
  dueDate.setDate(dueDate.getDate() + 30)
  
  doc.text(invoiceDate, rightCol + 35, yPos)
  doc.text(dueDate.toLocaleDateString(), rightCol + 35, yPos + 7)
  
  const status = parseFloat(transaction.remaining_amount) <= 0 ? 'PAID' : 'OUTSTANDING'
  doc.setTextColor(status === 'PAID' ? 16 : 239, status === 'PAID' ? 185 : 68, status === 'PAID' ? 129 : 68)
  doc.setFont('helvetica', 'bold')
  doc.text(status, rightCol + 35, yPos + 14)

  // Line items table
  yPos = 95

  const tableData = [
    [
      transaction.products?.product_name || 'Product/Service',
      transaction.quantity?.toString() || '1',
      `${currency}${parseFloat(transaction.unit_price || 0).toFixed(2)}`,
      `${currency}${parseFloat(transaction.total_amount || 0).toFixed(2)}`,
    ],
  ]

  doc.autoTable({
    startY: yPos,
    head: [['Description', 'Qty', 'Unit Price', 'Amount']],
    body: tableData,
    theme: 'striped',
    headStyles: {
      fillColor: primaryColor,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    styles: {
      fontSize: 10,
      cellPadding: 8,
    },
    columnStyles: {
      0: { cellWidth: 80 },
      1: { cellWidth: 30, halign: 'center' },
      2: { cellWidth: 35, halign: 'right' },
      3: { cellWidth: 35, halign: 'right' },
    },
  })

  // Totals
  const finalY = doc.lastAutoTable.finalY + 10
  const totalsX = pageWidth - 80

  doc.setFontSize(10)
  doc.setTextColor(...mutedColor)
  doc.text('Subtotal:', totalsX, finalY)
  doc.text('Paid:', totalsX, finalY + 8)
  doc.setFont('helvetica', 'bold')
  doc.text('Balance Due:', totalsX, finalY + 18)

  doc.setTextColor(...textColor)
  doc.setFont('helvetica', 'normal')
  doc.text(`${currency}${parseFloat(transaction.total_amount || 0).toFixed(2)}`, pageWidth - 20, finalY, { align: 'right' })
  doc.text(`${currency}${parseFloat(transaction.paid_amount || 0).toFixed(2)}`, pageWidth - 20, finalY + 8, { align: 'right' })
  
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  const remaining = parseFloat(transaction.remaining_amount || 0)
  doc.setTextColor(remaining > 0 ? 239 : 16, remaining > 0 ? 68 : 185, remaining > 0 ? 68 : 129)
  doc.text(`${currency}${remaining.toFixed(2)}`, pageWidth - 20, finalY + 18, { align: 'right' })

  // Footer
  const footerY = doc.internal.pageSize.getHeight() - 30
  doc.setDrawColor(229, 231, 235)
  doc.line(20, footerY - 10, pageWidth - 20, footerY - 10)

  doc.setFontSize(9)
  doc.setTextColor(...mutedColor)
  doc.setFont('helvetica', 'normal')
  doc.text('Thank you for your business!', pageWidth / 2, footerY, { align: 'center' })
  
  if (companyEmail || companyPhone) {
    const contactLine = [companyEmail, companyPhone].filter(Boolean).join(' | ')
    doc.text(contactLine, pageWidth / 2, footerY + 6, { align: 'center' })
  }

  // Save the PDF
  const fileName = `invoice-${invoiceNumber}.pdf`
  doc.save(fileName)

  return fileName
}

/**
 * Generate invoices for multiple transactions
 * @param {Array} transactions - Array of transaction data
 * @param {Object} options - Optional settings
 */
export function generateBulkInvoices(transactions, options = {}) {
  transactions.forEach(transaction => {
    generateInvoice(transaction, options)
  })
}
