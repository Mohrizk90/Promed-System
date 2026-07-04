import { createContext, useContext, useState, useEffect } from 'react'
import { translations } from '../translations'

const LanguageContext = createContext()

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(() => {
    // Get saved language from localStorage or default to 'en'
    return localStorage.getItem('language') || 'en'
  })

  useEffect(() => {
    // Save language preference to localStorage
    localStorage.setItem('language', language)
    // Update document direction
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.lang = language
  }, [language])

  const t = (key, params) => {
    const keys = key.split('.')
    let value = translations[language]
    
    for (const k of keys) {
      value = value?.[k]
    }
    
    if (value == null) return key
    // Guard: a key that points at a nested object (e.g. 'compliance.review')
    // must never be rendered as a React child — that throws React error #31 and
    // blanks the page. Fall back to the last key segment instead.
    if (typeof value === 'object') {
      if (import.meta.env?.DEV) {
        // eslint-disable-next-line no-console
        console.warn(`[i18n] key "${key}" resolves to an object, not a string`)
      }
      return keys[keys.length - 1]
    }
    if (params && typeof value === 'string') {
      return value.replace(/\{(\w+)\}/g, (match, name) =>
        params[name] != null ? params[name] : match
      )
    }
    return value
  }

  const toggleLanguage = () => {
    setLanguage(prev => prev === 'en' ? 'ar' : 'en')
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, toggleLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider')
  }
  return context
}
