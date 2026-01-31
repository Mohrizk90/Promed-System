export function downloadCsv(filename, rows) {
  if (!rows || rows.length === 0) return

  const headers = Object.keys(rows[0])

  const escapeValue = (value) => {
    if (value === null || value === undefined) return '""'
    const str = String(value)
    const escaped = str.replace(/"/g, '""')
    return `"${escaped}"`
  }

  const lines = []
  lines.push(headers.join(','))
  for (const row of rows) {
    const line = headers.map((h) => escapeValue(row[h])).join(',')
    lines.push(line)
  }

  const csvContent = lines.join('\r\n')
  // Add UTF-8 BOM so Excel (especially on Windows) shows Arabic correctly
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', filename)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  URL.revokeObjectURL(url)
}

