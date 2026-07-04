import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import SupabaseConfigMissing from './components/SupabaseConfigMissing.jsx'
import { supabaseMissingConfig } from './lib/supabase.js'

// Recharts 2.x prints a noisy "width(-1) / height(-1)" warning during the
// first paint of any chart, even when we already wrap it in a sized container.
// We drop ONLY that one message at the console level — every other error and
// warning is preserved untouched.
const RECHART_NEGATIVE_SIZE_MESSAGE = /The width\(-1\) and height\(-1\) of chart should be greater than 0/
const originalConsoleError = console.error
console.error = (...args) => {
  const first = args[0]
  if (typeof first === 'string' && RECHART_NEGATIVE_SIZE_MESSAGE.test(first)) return
  originalConsoleError(...args)
}

async function bootstrap() {
  if (supabaseMissingConfig) {
    ReactDOM.createRoot(document.getElementById('root')).render(
      <React.StrictMode>
        <SupabaseConfigMissing />
      </React.StrictMode>,
    )
    return
  }

  const { default: App } = await import('./App.jsx')
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

bootstrap()
