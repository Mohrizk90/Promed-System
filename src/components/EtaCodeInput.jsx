import { useEffect, useRef, useState } from 'react'

/**
 * Searchable ETA item-code picker.
 * - `value` is the current item_code text (free typing allowed).
 * - `onChange(text)` fires on manual typing.
 * - `onSelect(codeObject)` fires when a catalog entry is chosen.
 */
export default function EtaCodeInput({
  value,
  onChange,
  onSelect,
  codes = [],
  placeholder,
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const query = String(value || '').toLowerCase()
  const suggestions = codes
    .filter((c) => {
      if (!query) return true
      return (
        String(c.item_code || '').toLowerCase().includes(query) ||
        String(c.item_name || '').toLowerCase().includes(query) ||
        String(c.category || '').toLowerCase().includes(query)
      )
    })
    .slice(0, 30)

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={value || ''}
        onChange={(e) => {
          onChange?.(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded shadow-lg max-h-52 overflow-auto">
          {suggestions.map((c) => (
            <button
              key={c.id ?? c.item_code}
              type="button"
              onClick={() => {
                onSelect?.(c)
                setOpen(false)
              }}
              className="block w-full text-start px-3 py-1.5 hover:bg-blue-50 text-sm"
            >
              <span className="font-medium text-gray-900">{c.item_code}</span>
              {(c.item_name || c.category) && (
                <span className="block text-[11px] text-gray-500">
                  {[c.item_name, c.category].filter(Boolean).join(' · ')}
                  {c.unit_type ? ` · ${c.unit_type}` : ''}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
