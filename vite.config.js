import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'router': ['react-router-dom'],
          'supabase': ['@supabase/supabase-js']
        }
      }
    },
    chunkSizeWarningLimit: 600
  },
  server: {
    hmr: {
      overlay: true
    },
    proxy: process.env.VITE_API_PROXY
      ? {
          '/api': {
            target: process.env.VITE_API_PROXY,
            changeOrigin: true,
          },
        }
      : undefined,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.js'
  }
})
