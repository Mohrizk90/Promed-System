import { useState, useRef } from 'react'
import Modal from './ui/Modal'
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle, X } from './ui/Icons'
import { readCsvFile, mapCsvToTransactions, validateTransactions } from '../utils/importCsv'
import { useLanguage } from '../context/LanguageContext'

export default function CsvImportModal({
  isOpen,
  onClose,
  onImport,
  type = 'client', // 'client' or 'supplier'
}) {
  const [step, setStep] = useState(1) // 1: upload, 2: mapping, 3: preview
  const [file, setFile] = useState(null)
  const [csvData, setCsvData] = useState([])
  const [csvHeaders, setCsvHeaders] = useState([])
  const [mappedData, setMappedData] = useState([])
  const [validation, setValidation] = useState(null)
  const [columnMapping, setColumnMapping] = useState({
    clientName: '',
    productName: '',
    quantity: '',
    unitPrice: '',
    totalAmount: '',
    paidAmount: '',
    transactionDate: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const fileInputRef = useRef(null)
  const { t } = useLanguage()

  const entityField = type === 'client' ? 'clientName' : 'supplierName'
  const entityLabel = type === 'client' ? 'Client Name' : 'Supplier Name'

  const handleFileChange = async (e) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    setFile(selectedFile)
    setError(null)
    setLoading(true)

    try {
      const data = await readCsvFile(selectedFile)
      if (data.length === 0) {
        throw new Error('CSV file is empty')
      }

      setCsvData(data)
      setCsvHeaders(Object.keys(data[0]))
      
      // Auto-detect column mappings
      const headers = Object.keys(data[0]).map(h => h.toLowerCase())
      const autoMapping = { ...columnMapping }
      
      headers.forEach((header, index) => {
        const originalHeader = Object.keys(data[0])[index]
        if (header.includes('client') || header.includes('customer')) {
          autoMapping.clientName = originalHeader
        } else if (header.includes('supplier') || header.includes('vendor')) {
          autoMapping.supplierName = originalHeader
        } else if (header.includes('product') || header.includes('item') || header.includes('description')) {
          autoMapping.productName = originalHeader
        } else if (header.includes('qty') || header.includes('quantity')) {
          autoMapping.quantity = originalHeader
        } else if (header.includes('unit') && header.includes('price')) {
          autoMapping.unitPrice = originalHeader
        } else if (header.includes('total') || header.includes('amount')) {
          if (!autoMapping.totalAmount) autoMapping.totalAmount = originalHeader
        } else if (header.includes('paid')) {
          autoMapping.paidAmount = originalHeader
        } else if (header.includes('date')) {
          autoMapping.transactionDate = originalHeader
        }
      })

      setColumnMapping(autoMapping)
      setStep(2)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleMappingChange = (field, value) => {
    setColumnMapping(prev => ({
      ...prev,
      [field]: value,
    }))
  }

  const handlePreview = () => {
    const mapped = mapCsvToTransactions(csvData, columnMapping)
    const validationResult = validateTransactions(mapped)
    
    setMappedData(mapped)
    setValidation(validationResult)
    setStep(3)
  }

  const handleImport = async () => {
    if (!validation?.valid || validation.valid.length === 0) return
    
    setLoading(true)
    try {
      await onImport(validation.valid)
      handleClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setStep(1)
    setFile(null)
    setCsvData([])
    setCsvHeaders([])
    setMappedData([])
    setValidation(null)
    setColumnMapping({
      clientName: '',
      productName: '',
      quantity: '',
      unitPrice: '',
      totalAmount: '',
      paidAmount: '',
      transactionDate: '',
    })
    setError(null)
    onClose()
  }

  const requiredFields = [
    { key: entityField, label: entityLabel },
    { key: 'productName', label: 'Product Name' },
    { key: 'quantity', label: 'Quantity' },
  ]

  const optionalFields = [
    { key: 'unitPrice', label: 'Unit Price' },
    { key: 'totalAmount', label: 'Total Amount' },
    { key: 'paidAmount', label: 'Paid Amount' },
    { key: 'transactionDate', label: 'Transaction Date' },
  ]

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Import ${type === 'client' ? 'Client' : 'Supplier'} Transactions`}
      size="lg"
    >
      <div className="space-y-6">
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-4">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step >= s
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
                }`}
              >
                {s}
              </div>
              {s < 3 && (
                <div
                  className={`w-12 h-1 rounded ${
                    step > s ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Error display */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400">
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        )}

        {/* Step 1: Upload */}
        {step === 1 && (
          <div className="text-center py-8">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-12 cursor-pointer hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
            >
              <FileSpreadsheet className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <p className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                Drop your CSV file here
              </p>
              <p className="text-gray-500 dark:text-gray-400">
                or click to browse
              </p>
            </div>
            <p className="mt-4 text-sm text-gray-500">
              Supported format: CSV with headers
            </p>
          </div>
        )}

        {/* Step 2: Column Mapping */}
        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Map your CSV columns to the transaction fields. Required fields are marked with *.
            </p>

            <div className="grid grid-cols-2 gap-4">
              {/* Required fields */}
              {requiredFields.map(({ key, label }) => (
                <div key={key}>
                  <label className="label">{label} *</label>
                  <select
                    value={columnMapping[key] || ''}
                    onChange={(e) => handleMappingChange(key, e.target.value)}
                    className="input"
                  >
                    <option value="">Select column...</option>
                    {csvHeaders.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
              ))}

              {/* Optional fields */}
              {optionalFields.map(({ key, label }) => (
                <div key={key}>
                  <label className="label">{label}</label>
                  <select
                    value={columnMapping[key] || ''}
                    onChange={(e) => handleMappingChange(key, e.target.value)}
                    className="input"
                  >
                    <option value="">Select column...</option>
                    {csvHeaders.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="flex justify-between pt-4">
              <button onClick={() => setStep(1)} className="btn btn-secondary">
                Back
              </button>
              <button
                onClick={handlePreview}
                disabled={!requiredFields.every((f) => columnMapping[f.key])}
                className="btn btn-primary"
              >
                Preview Import
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Preview */}
        {step === 3 && validation && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {validation.totalRows}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">Total Rows</p>
              </div>
              <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {validation.validCount}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">Valid</p>
              </div>
              <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {validation.errorCount}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">Errors</p>
              </div>
            </div>

            {/* Errors */}
            {validation.errors.length > 0 && (
              <div className="max-h-40 overflow-y-auto">
                <p className="text-sm font-medium text-red-600 dark:text-red-400 mb-2">
                  Rows with errors (will be skipped):
                </p>
                {validation.errors.map((err) => (
                  <div
                    key={err.row}
                    className="flex items-start gap-2 p-2 bg-red-50 dark:bg-red-900/10 rounded mb-1"
                  >
                    <X size={16} className="text-red-500 mt-0.5" />
                    <div>
                      <span className="font-medium">Row {err.row}:</span>{' '}
                      {err.errors.join(', ')}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Preview table */}
            <div className="max-h-60 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      {entityLabel}
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      Product
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                      Qty
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {validation.valid.slice(0, 10).map((row, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-sm">{row.client_name}</td>
                      <td className="px-3 py-2 text-sm">{row.product_name}</td>
                      <td className="px-3 py-2 text-sm text-right">{row.quantity}</td>
                      <td className="px-3 py-2 text-sm text-right">
                        ${row.total_amount.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {validation.valid.length > 10 && (
                <p className="p-2 text-center text-sm text-gray-500 bg-gray-50 dark:bg-gray-800">
                  ...and {validation.valid.length - 10} more rows
                </p>
              )}
            </div>

            <div className="flex justify-between pt-4">
              <button onClick={() => setStep(2)} className="btn btn-secondary">
                Back
              </button>
              <button
                onClick={handleImport}
                disabled={validation.validCount === 0 || loading}
                className="btn btn-primary"
              >
                {loading ? 'Importing...' : `Import ${validation.validCount} Transactions`}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
