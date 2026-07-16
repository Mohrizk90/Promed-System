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
    proxy: {
      ...(process.env.VITE_API_PROXY
        ? {
            '/api': {
              target: process.env.VITE_API_PROXY,
              changeOrigin: true,
            },
          }
        : {}),
      '/mcp': {
        target: process.env.VITE_MCP_PROXY || 'http://127.0.0.1:8082',
        changeOrigin: true,
      },
      '/bot-health': {
        target: process.env.VITE_BOT_HEALTH_PROXY || 'http://127.0.0.1:8081',
        changeOrigin: true,
      },
      '/collector-health': {
        target:
          process.env.VITE_COLLECTOR_HEALTH_PROXY || 'http://127.0.0.1:8083',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.js'
  }
})
