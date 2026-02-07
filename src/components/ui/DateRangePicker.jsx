import { useState, useRef, useEffect } from 'react'
import { Calendar, ChevronLeft, ChevronRight, X } from './Icons'

const presets = [
  { label: 'Today', getValue: () => ({ start: new Date(), end: new Date() }) },
  { label: 'Yesterday', getValue: () => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return { start: d, end: d }
  }},
  { label: 'Last 7 days', getValue: () => {
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - 6)
    return { start, end }
  }},
  { label: 'Last 30 days', getValue: () => {
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - 29)
    return { start, end }
  }},
  { label: 'This month', getValue: () => {
    const start = new Date()
    start.setDate(1)
    return { start, end: new Date() }
  }},
  { label: 'Last month', getValue: () => {
    const end = new Date()
    end.setDate(0) // Last day of previous month
    const start = new Date(end)
    start.setDate(1)
    return { start, end }
  }},
  { label: 'This year', getValue: () => {
    const start = new Date()
    start.setMonth(0, 1)
    return { start, end: new Date() }
  }},
]

export default function DateRangePicker({
  startDate,
  endDate,
  onChange,
  placeholder = 'Select date range',
  showPresets = true,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [viewDate, setViewDate] = useState(new Date())
  const [selecting, setSelecting] = useState('start') // 'start' or 'end'
  const [tempStart, setTempStart] = useState(startDate)
  const [tempEnd, setTempEnd] = useState(endDate)
  const containerRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const formatDate = (date) => {
    if (!date) return ''
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const getDaysInMonth = (date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startingDay = firstDay.getDay()
    
    const days = []
    
    // Add empty cells for days before the first day of the month
    for (let i = 0; i < startingDay; i++) {
      days.push(null)
    }
    
    // Add days of the month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i))
    }
    
    return days
  }

  const isInRange = (date) => {
    if (!tempStart || !tempEnd || !date) return false
    return date >= tempStart && date <= tempEnd
  }

  const isSelected = (date) => {
    if (!date) return false
    return (tempStart && date.toDateString() === tempStart.toDateString()) ||
           (tempEnd && date.toDateString() === tempEnd.toDateString())
  }

  const handleDateClick = (date) => {
    if (!date) return
    
    if (selecting === 'start' || (tempStart && date < tempStart)) {
      setTempStart(date)
      setTempEnd(null)
      setSelecting('end')
    } else {
      setTempEnd(date)
      onChange({ start: tempStart, end: date })
      setIsOpen(false)
      setSelecting('start')
    }
  }

  const handlePresetClick = (preset) => {
    const { start, end } = preset.getValue()
    setTempStart(start)
    setTempEnd(end)
    onChange({ start, end })
    setIsOpen(false)
  }

  const clearSelection = () => {
    setTempStart(null)
    setTempEnd(null)
    onChange({ start: null, end: null })
  }

  const prevMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))
  }

  const nextMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))
  }

  const days = getDaysInMonth(viewDate)
  const displayText = startDate && endDate 
    ? `${formatDate(startDate)} - ${formatDate(endDate)}`
    : startDate 
    ? `${formatDate(startDate)} - ...`
    : placeholder

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="input flex items-center justify-between gap-2 min-w-[260px]"
      >
        <span className="flex items-center gap-2">
          <Calendar size={18} className="text-gray-400" />
          <span className={startDate ? 'text-gray-900' : 'text-gray-400'}>
            {displayText}
          </span>
        </span>
        {startDate && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              clearSelection()
            }}
            className="p-1 hover:bg-gray-200 rounded"
          >
            <X size={14} />
          </button>
        )}
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-2 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
          <div className="flex">
            {/* Presets */}
            {showPresets && (
              <div className="w-40 border-r border-gray-200 p-2 bg-gray-50">
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => handlePresetClick(preset)}
                    className="w-full px-3 py-2 text-left text-sm rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            )}

            {/* Calendar */}
            <div className="p-4">
              {/* Month navigation */}
              <div className="flex items-center justify-between mb-4">
                <button
                  type="button"
                  onClick={prevMonth}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <ChevronLeft size={20} />
                </button>
                <span className="font-semibold">
                  {viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </span>
                <button
                  type="button"
                  onClick={nextMonth}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <ChevronRight size={20} />
                </button>
              </div>

              {/* Days header */}
              <div className="grid grid-cols-7 gap-1 mb-2">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
                  <div
                    key={day}
                    className="w-9 h-9 flex items-center justify-center text-xs font-medium text-gray-400"
                  >
                    {day}
                  </div>
                ))}
              </div>

              {/* Days grid */}
              <div className="grid grid-cols-7 gap-1">
                {days.map((date, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => handleDateClick(date)}
                    disabled={!date}
                    className={`w-9 h-9 flex items-center justify-center text-sm rounded-lg transition-colors ${
                      !date 
                        ? 'invisible' 
                        : isSelected(date)
                        ? 'bg-blue-600 text-white'
                        : isInRange(date)
                        ? 'bg-blue-100 text-blue-700'
                        : 'hover:bg-gray-100'
                    }`}
                  >
                    {date?.getDate()}
                  </button>
                ))}
              </div>

              {/* Selection hint */}
              <div className="mt-4 pt-4 border-t border-gray-200 text-xs text-gray-500 text-center">
                {selecting === 'start' ? 'Select start date' : 'Select end date'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
