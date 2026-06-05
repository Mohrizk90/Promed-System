import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { MoreVertical, ChevronDown } from './Icons'

export default function Dropdown({
  trigger,
  items = [],
  align = 'right', // left, right
  className = '',
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [openUpward, setOpenUpward] = useState(false)
  const dropdownRef = useRef(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)

  const updateMenuPlacement = useCallback(() => {
    const button = buttonRef.current
    const menu = menuRef.current
    if (!button || !menu) return

    const buttonRect = button.getBoundingClientRect()
    const menuHeight = menu.offsetHeight
    const gap = 8
    const spaceBelow = window.innerHeight - buttonRect.bottom
    const spaceAbove = buttonRect.top

    setOpenUpward(spaceBelow < menuHeight + gap && spaceAbove > spaceBelow)
  }, [])

  useLayoutEffect(() => {
    if (!isOpen) {
      setOpenUpward(false)
      return
    }
    updateMenuPlacement()
  }, [isOpen, items, updateMenuPlacement])

  useEffect(() => {
    if (!isOpen) return

    const handleReposition = () => updateMenuPlacement()
    window.addEventListener('resize', handleReposition)
    window.addEventListener('scroll', handleReposition, true)

    return () => {
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
    }
  }, [isOpen, updateMenuPlacement])

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  const handleItemClick = (item) => {
    if (item.onClick) {
      item.onClick()
    }
    setIsOpen(false)
  }

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        {trigger || <MoreVertical size={20} />}
      </button>

      {isOpen && (
        <div 
          ref={menuRef}
          className={`dropdown ${align === 'left' ? 'left-0' : 'right-0'} ${openUpward ? 'dropdown-up' : ''}`}
          role="menu"
        >
          {items.map((item, index) => {
            if (item.divider) {
              return <div key={index} className="h-px bg-gray-200 my-1" />
            }

            const Icon = item.icon

            return (
              <button
                key={index}
                onClick={() => handleItemClick(item)}
                disabled={item.disabled}
                className={`dropdown-item ${item.danger ? 'text-red-600 hover:bg-red-50' : ''} ${item.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                role="menuitem"
              >
                {Icon && <Icon size={16} />}
                <span>{item.label}</span>
                {item.shortcut && (
                  <span className="ml-auto text-xs text-gray-400">{item.shortcut}</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Select dropdown variant
export function Select({
  value,
  onChange,
  options = [],
  placeholder = 'Select...',
  className = '',
  disabled = false,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const selectRef = useRef(null)

  const selectedOption = options.find(opt => opt.value === value)

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (selectRef.current && !selectRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={selectRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`input flex items-center justify-between gap-2 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className={selectedOption ? 'text-gray-900' : 'text-gray-400'}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown size={16} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 max-h-60 overflow-y-auto">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value)
                setIsOpen(false)
              }}
              className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 transition-colors ${
                option.value === value 
                  ? 'bg-blue-50 text-blue-600' 
                  : 'text-gray-700'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
