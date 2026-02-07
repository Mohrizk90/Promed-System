/**
 * Parse CSV file content into array of objects
 * @param {string} csvContent - Raw CSV content
 * @param {Object} options - Parsing options
 * @returns {Array} Parsed data
 */
export function parseCsv(csvContent, options = {}) {
  const {
    delimiter = ',',
    hasHeader = true,
    skipEmptyLines = true,
  } = options

  let lines = csvContent.split(/\r?\n/)
  
  if (skipEmptyLines) {
    lines = lines.filter(line => line.trim())
  }

  if (lines.length === 0) return []

  // Parse header row
  const headers = hasHeader 
    ? parseRow(lines[0], delimiter) 
    : lines[0].split(delimiter).map((_, i) => `column_${i}`)

  const dataLines = hasHeader ? lines.slice(1) : lines

  return dataLines
    .filter(line => skipEmptyLines ? line.trim() : true)
    .map(line => {
      const values = parseRow(line, delimiter)
      const row = {}
      headers.forEach((header, index) => {
        row[header.trim()] = values[index]?.trim() || ''
      })
      return row
    })
}

/**
 * Parse a single CSV row, handling quoted fields
 * @param {string} row - CSV row
 * @param {string} delimiter - Field delimiter
 * @returns {Array} Array of field values
 */
function parseRow(row, delimiter) {
  const fields = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < row.length; i++) {
    const char = row[i]
    const nextChar = row[i + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"'
        i++
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes
      }
    } else if (char === delimiter && !inQuotes) {
      fields.push(current)
      current = ''
    } else {
      current += char
    }
  }

  fields.push(current)
  return fields
}

/**
 * Read and parse a CSV file
 * @param {File} file - File object from input
 * @param {Object} options - Parsing options
 * @returns {Promise<Array>} Parsed data
 */
export function readCsvFile(file, options = {}) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file provided'))
      return
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      reject(new Error('File must be a CSV file'))
      return
    }

    const reader = new FileReader()

    reader.onload = (event) => {
      try {
        const content = event.target.result
        const data = parseCsv(content, options)
        resolve(data)
      } catch (error) {
        reject(new Error(`Failed to parse CSV: ${error.message}`))
      }
    }

    reader.onerror = () => {
      reject(new Error('Failed to read file'))
    }

    reader.readAsText(file)
  })
}

/**
 * Map CSV data to transaction format
 * @param {Array} csvData - Parsed CSV data
 * @param {Object} columnMapping - Mapping of CSV columns to transaction fields
 * @returns {Array} Mapped transaction data
 */
export function mapCsvToTransactions(csvData, columnMapping) {
  const {
    clientName = 'client_name',
    supplierName = 'supplier_name',
    productName = 'product_name',
    quantity = 'quantity',
    unitPrice = 'unit_price',
    totalAmount = 'total_amount',
    paidAmount = 'paid_amount',
    transactionDate = 'transaction_date',
  } = columnMapping

  return csvData.map((row, index) => {
    const qty = parseInt(row[quantity]) || 1
    const price = parseFloat(row[unitPrice]) || 0
    const total = parseFloat(row[totalAmount]) || (qty * price)
    const paid = parseFloat(row[paidAmount]) || 0
    const entityName = row[clientName] || row[supplierName] || ''

    return {
      _rowIndex: index + 1,
      client_name: entityName,
      product_name: row[productName] || '',
      quantity: qty,
      unit_price: price,
      total_amount: total,
      paid_amount: paid,
      remaining_amount: total - paid,
      transaction_date: row[transactionDate] || new Date().toISOString().split('T')[0],
    }
  })
}

/**
 * Validate mapped transaction data
 * @param {Array} transactions - Mapped transaction data
 * @returns {Object} Validation result
 */
export function validateTransactions(transactions) {
  const errors = []
  const warnings = []
  const valid = []

  transactions.forEach((tx) => {
    const rowErrors = []
    const rowWarnings = []

    // Required fields
    if (!tx.client_name) {
      rowErrors.push('Client name is required')
    }
    if (!tx.product_name) {
      rowErrors.push('Product name is required')
    }
    if (tx.quantity <= 0) {
      rowErrors.push('Quantity must be greater than 0')
    }
    if (tx.total_amount < 0) {
      rowErrors.push('Total amount cannot be negative')
    }

    // Warnings
    if (tx.unit_price === 0) {
      rowWarnings.push('Unit price is 0')
    }
    if (tx.paid_amount > tx.total_amount) {
      rowWarnings.push('Paid amount exceeds total amount')
    }

    if (rowErrors.length > 0) {
      errors.push({
        row: tx._rowIndex,
        errors: rowErrors,
        data: tx,
      })
    } else if (rowWarnings.length > 0) {
      warnings.push({
        row: tx._rowIndex,
        warnings: rowWarnings,
        data: tx,
      })
      valid.push(tx)
    } else {
      valid.push(tx)
    }
  })

  return {
    valid,
    errors,
    warnings,
    hasErrors: errors.length > 0,
    totalRows: transactions.length,
    validCount: valid.length,
    errorCount: errors.length,
  }
}
