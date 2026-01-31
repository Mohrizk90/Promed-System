import { createContext, useContext, useEffect, useState, useCallback } from 'react'

const KeyboardShortcutsContext = createContext()

// Default shortcuts
const defaultShortcuts = {
  'n': { description: 'Add new', action: null },
  '/': { description: 'Search', action: null },
  'Escape': { description: 'Close/Cancel', action: null },
  'd': { description: 'Go to Dashboard', action: null },
  'c': { description: 'Go to Client Transactions', action: null },
  's': { description: 'Go to Supplier Transactions', action: null },
  'e': { description: 'Go to Entities', action: null },
  '?': { description: 'Show shortcuts', action: null },
}

export function KeyboardShortcutsProvider({ children }) {
  const [shortcuts, setShortcuts] = useState(defaultShortcuts)
  const [showHelp, setShowHelp] = useState(false)
  const [enabled, setEnabled] = useState(true)

  const registerShortcut = useCallback((key, action, description) => {
    setShortcuts(prev => ({
      ...prev,
      [key]: { description: description || prev[key]?.description || key, action },
    }))
  }, [])

  const unregisterShortcut = useCallback((key) => {
    setShortcuts(prev => ({
      ...prev,
      [key]: { ...prev[key], action: null },
    }))
  }, [])

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (e) => {
      // Don't trigger shortcuts when typing in inputs
      const target = e.target
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        // Only allow Escape in inputs
        if (e.key !== 'Escape') return
      }

      // Show help on ?
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setShowHelp(true)
        return
      }

      // Close help on Escape
      if (e.key === 'Escape' && showHelp) {
        setShowHelp(false)
        return
      }

      // Check for registered shortcuts
      const shortcut = shortcuts[e.key]
      if (shortcut?.action && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        shortcut.action()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [shortcuts, enabled, showHelp])

  const value = {
    shortcuts,
    registerShortcut,
    unregisterShortcut,
    showHelp,
    setShowHelp,
    enabled,
    setEnabled,
  }

  return (
    <KeyboardShortcutsContext.Provider value={value}>
      {children}
      {showHelp && <ShortcutsHelpModal onClose={() => setShowHelp(false)} shortcuts={shortcuts} />}
    </KeyboardShortcutsContext.Provider>
  )
}

function ShortcutsHelpModal({ onClose, shortcuts }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal-content max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            Keyboard Shortcuts
          </h2>
        </div>
        <div className="modal-body">
          <div className="space-y-2">
            {Object.entries(shortcuts)
              .filter(([_, shortcut]) => shortcut.description)
              .map(([key, shortcut]) => (
                <div 
                  key={key}
                  className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0"
                >
                  <span className="text-gray-700 dark:text-gray-300">
                    {shortcut.description}
                  </span>
                  <kbd className="kbd">
                    {key === ' ' ? 'Space' : key}
                  </kbd>
                </div>
              ))}
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export function useKeyboardShortcuts() {
  const context = useContext(KeyboardShortcutsContext)
  if (!context) {
    throw new Error('useKeyboardShortcuts must be used within a KeyboardShortcutsProvider')
  }
  return context
}
