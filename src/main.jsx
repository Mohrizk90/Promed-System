import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import SupabaseConfigMissing from './components/SupabaseConfigMissing.jsx'
import { supabaseMissingConfig } from './lib/supabase.js'
import { initPwa } from './utils/pwa.js'

initPwa()

// Recharts 2.x prints a noisy "width(-1) / height(-1)" warning during the
// first paint of any chart. Suppress only that message; leave all other
// console output intact.
const RECHART_NEGATIVE_SIZE_MESSAGE = /width\(-1\).*height\(-1\).*chart should be greater than 0/i
function isRechartsNegativeSizeNoise(args) {
  const text = args.map((a) => (typeof a === 'string' ? a : '')).join(' ')
  return RECHART_NEGATIVE_SIZE_MESSAGE.test(text)
}
for (const level of ['error', 'warn']) {
  const original = console[level]
  console[level] = (...args) => {
    if (isRechartsNegativeSizeNoise(args)) return
    original(...args)
  }
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

  // Dev-only UI preview with sample data (stripped from production builds).
  if (import.meta.env.DEV && window.location.pathname.startsWith('/__preview')) {
    const { default: DevPreview } = await import('./dev/DevPreview.jsx')
    ReactDOM.createRoot(document.getElementById('root')).render(<DevPreview />)
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
