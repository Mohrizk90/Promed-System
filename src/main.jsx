import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import SupabaseConfigMissing from './components/SupabaseConfigMissing.jsx'
import { supabaseMissingConfig } from './lib/supabase.js'

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
