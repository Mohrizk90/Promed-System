import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical, ChevronDown } from './Icons'

const MENU_GAP = 8
const MENU_WIDTH = 192
const VIEWPORT_PADDING = 8

export default function Dropdown({
  trigger,
  items = [],
  align = 'right', // left, right
  className = '',
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) return

    const triggerRect = trigger.getBoundingClientRect()
    const menuRect = menu.getBoundingClientRect()
    const menuHeight = menuRect.height || MENU_WIDTH
    const menuWidth = menuRect.width || MENU_WIDTH

    const spaceBelow = window.innerHeight - triggerRect.bottom - MENU_GAP
    const spaceAbove = triggerRect.top - MENU_GAP
    const openUp = spaceBelow < menuHeight && spaceAbove > spaceBelow
    const placement = openUp ? 'up' : 'down'

    let top =
      placement === 'down'
        ? triggerRect.bottom + MENU_GAP
        : triggerRect.top - menuHeight - MENU_GAP

    let left =
      align === 'right' ? triggerRect.right - menuWidth : triggerRect.left

    left = Math.max(
      VIEWPORT_PADDING,
      Math.min(left, window.innerWidth - menuWidth - VIEWPORT_PADDING)
    )

    if (placement === 'down') {
      top = Math.min(top, window.innerHeight - menuHeight - VIEWPORT_PADDING)
    } else {
      top = Math.max(VIEWPORT_PADDING, top)
    }

    menu.style.top = `${top}px`
    menu.style.left = `${left}px`
    menu.style.visibility = 'visible'
    menu.classList.remove('dropdown-up', 'dropdown-down')
    menu.classList.add(`dropdown-${placement}`)
  }, [align])

  useLayoutEffect(() => {
    if (!isOpen) return

    updatePosition()

    const handleScrollOrResize = () => updatePosition()
    window.addEventListener('resize', handleScrollOrResize)
    document.addEventListener('scroll', handleScrollOrResize, true)

    return () => {
      window.removeEventListener('resize', handleScrollOrResize)
      document.removeEventListener('scroll', handleScrollOrResize, true)
    }
  }, [isOpen, updatePosition])

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event) => {
      const inContainer = containerRef.current?.contains(event.target)
      const inMenu = menuRef.current?.contains(event.target)
      if (!inContainer && !inMenu) {
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
  }, [isOpen])

  const handleItemClick = (item) => {
    if (item.onClick) {
      item.onClick()
    }
    setIsOpen(false)
  }

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        {trigger || <MoreVertical size={20} />}
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={menuRef}
            className="dropdown dropdown-down"
            style={{
              position: 'fixed',
              visibility: 'hidden',
              zIndex: 9999,
              width: MENU_WIDTH,
            }}
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
          </div>,
          document.body
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
