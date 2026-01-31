import { useState, useMemo } from 'react'
import { ChevronUp, ChevronDown, Check, Minus, MoreVertical } from './ui/Icons'
import Pagination from './ui/Pagination'
import Dropdown from './ui/Dropdown'
import { EmptyStateCompact } from './ui/EmptyState'

export default function DataTable({
  columns,
  data,
  keyField = 'id',
  sortable = true,
  selectable = false,
  paginated = true,
  pageSize: initialPageSize = 10,
  onRowClick,
  onSelectionChange,
  actions,
  emptyMessage = 'No data available',
  emptyIcon = 'default',
  loading = false,
  expandable = false,
  renderExpanded,
  className = '',
}) {
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' })
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [selectedRows, setSelectedRows] = useState(new Set())
  const [expandedRows, setExpandedRows] = useState(new Set())

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortConfig.key) return data
    
    return [...data].sort((a, b) => {
      const aVal = a[sortConfig.key]
      const bVal = b[sortConfig.key]
      
      if (aVal === null || aVal === undefined) return 1
      if (bVal === null || bVal === undefined) return -1
      
      let comparison = 0
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal
      } else if (aVal instanceof Date && bVal instanceof Date) {
        comparison = aVal.getTime() - bVal.getTime()
      } else {
        comparison = String(aVal).localeCompare(String(bVal))
      }
      
      return sortConfig.direction === 'desc' ? -comparison : comparison
    })
  }, [data, sortConfig])

  // Paginate data
  const paginatedData = useMemo(() => {
    if (!paginated) return sortedData
    const start = (currentPage - 1) * pageSize
    return sortedData.slice(start, start + pageSize)
  }, [sortedData, currentPage, pageSize, paginated])

  const totalPages = Math.ceil(sortedData.length / pageSize)

  // Handle sort
  const handleSort = (key) => {
    if (!sortable) return
    
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  // Handle selection
  const handleSelectAll = () => {
    if (selectedRows.size === paginatedData.length) {
      setSelectedRows(new Set())
      onSelectionChange?.([])
    } else {
      const allKeys = new Set(paginatedData.map(row => row[keyField]))
      setSelectedRows(allKeys)
      onSelectionChange?.(paginatedData)
    }
  }

  const handleSelectRow = (row) => {
    const key = row[keyField]
    const newSelected = new Set(selectedRows)
    
    if (newSelected.has(key)) {
      newSelected.delete(key)
    } else {
      newSelected.add(key)
    }
    
    setSelectedRows(newSelected)
    onSelectionChange?.(data.filter(r => newSelected.has(r[keyField])))
  }

  // Handle expand
  const toggleExpand = (key) => {
    const newExpanded = new Set(expandedRows)
    if (newExpanded.has(key)) {
      newExpanded.delete(key)
    } else {
      newExpanded.add(key)
    }
    setExpandedRows(newExpanded)
  }

  // Reset page when data changes
  useMemo(() => {
    setCurrentPage(1)
  }, [data.length])

  const isAllSelected = paginatedData.length > 0 && selectedRows.size === paginatedData.length
  const isSomeSelected = selectedRows.size > 0 && selectedRows.size < paginatedData.length

  if (loading) {
    return (
      <div className="table-container">
        <div className="animate-pulse">
          <div className="h-12 bg-gray-100 dark:bg-gray-700" />
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-4 px-4 py-3">
                {columns.map((_, j) => (
                  <div key={j} className="h-4 bg-gray-200 dark:bg-gray-600 rounded flex-1" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="table-container">
        <EmptyStateCompact message={emptyMessage} icon={emptyIcon} />
      </div>
    )
  }

  return (
    <div className={`table-container ${className}`}>
      <table className="table">
        <thead className="table-header">
          <tr>
            {selectable && (
              <th className="table-header-cell w-12">
                <button
                  onClick={handleSelectAll}
                  className="w-5 h-5 rounded border-2 flex items-center justify-center transition-colors
                    ${isAllSelected || isSomeSelected 
                      ? 'bg-blue-600 border-blue-600 text-white' 
                      : 'border-gray-300 dark:border-gray-600 hover:border-blue-500'}"
                >
                  {isAllSelected ? <Check size={14} /> : isSomeSelected ? <Minus size={14} /> : null}
                </button>
              </th>
            )}
            {expandable && <th className="table-header-cell w-12" />}
            {columns.map((column) => (
              <th
                key={column.key}
                onClick={() => column.sortable !== false && handleSort(column.key)}
                className={`table-header-cell ${column.className || ''} ${
                  column.sortable !== false && sortable ? 'cursor-pointer' : ''
                }`}
                style={{ width: column.width }}
              >
                <div className="flex items-center gap-1">
                  <span>{column.label}</span>
                  {sortable && column.sortable !== false && sortConfig.key === column.key && (
                    sortConfig.direction === 'asc' 
                      ? <ChevronUp size={14} /> 
                      : <ChevronDown size={14} />
                  )}
                </div>
              </th>
            ))}
            {actions && <th className="table-header-cell w-20">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {paginatedData.map((row) => {
            const key = row[keyField]
            const isExpanded = expandedRows.has(key)
            
            return (
              <Fragment key={key}>
                <tr
                  className={`table-row ${onRowClick ? 'cursor-pointer' : ''} ${
                    selectedRows.has(key) ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                  }`}
                  onClick={() => onRowClick?.(row)}
                >
                  {selectable && (
                    <td className="table-cell" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleSelectRow(row)}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                          selectedRows.has(key)
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'border-gray-300 dark:border-gray-600 hover:border-blue-500'
                        }`}
                      >
                        {selectedRows.has(key) && <Check size={14} />}
                      </button>
                    </td>
                  )}
                  {expandable && (
                    <td className="table-cell" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => toggleExpand(key)}
                        className={`p-1 rounded transition-transform ${
                          isExpanded ? 'rotate-90' : ''
                        }`}
                      >
                        <ChevronRight size={16} />
                      </button>
                    </td>
                  )}
                  {columns.map((column) => (
                    <td key={column.key} className={`table-cell ${column.cellClassName || ''}`}>
                      {column.render 
                        ? column.render(row[column.key], row) 
                        : row[column.key]}
                    </td>
                  ))}
                  {actions && (
                    <td className="table-cell" onClick={(e) => e.stopPropagation()}>
                      <Dropdown
                        items={typeof actions === 'function' ? actions(row) : actions}
                      />
                    </td>
                  )}
                </tr>
                {expandable && isExpanded && (
                  <tr>
                    <td colSpan={columns.length + (selectable ? 1 : 0) + (actions ? 1 : 0) + 1}>
                      {renderExpanded?.(row)}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      
      {paginated && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          pageSize={pageSize}
          onPageSizeChange={(size) => {
            setPageSize(size)
            setCurrentPage(1)
          }}
          totalItems={sortedData.length}
        />
      )}
    </div>
  )
}

// Helper Fragment import
import { Fragment } from 'react'
import { ChevronRight } from './ui/Icons'
