import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../context/ToastContext'
import { LanguageProvider } from '../context/LanguageContext'

// Mock supabase: empty data so the page renders the table with no rows
vi.mock('../lib/supabase', () => {
  const empty = () => Promise.resolve({ data: [], error: null })
  const channel = () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) })
  return {
    supabase: {
      from: () => ({
        select: () => ({ order: empty, eq: empty, gt: empty, single: empty }),
        insert: () => ({ select: () => ({ single: empty }) }),
        update: () => ({ eq: empty }),
        delete: () => ({ eq: empty })
      }),
      channel: channel,
      removeChannel: () => {},
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } })
      }
    }
  }
})

// Stub generateInvoice (jsdom doesn't support canvas)
vi.mock('../utils/generateInvoice', () => ({ generateInvoice: () => Promise.resolve() }))

import ClientTransactions from './ClientTransactions'

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <LanguageProvider>
        <ToastProvider>
          <ClientTransactions />
        </ToastProvider>
      </LanguageProvider>
    </MemoryRouter>
  )

describe('ClientTransactions - All Months filter', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: { getItem: () => 'en', setItem: () => {} },
      writable: true
    })
  })

  it('does not throw when All Months is clicked', async () => {
    // Track errors that occur during render
    const errors = []
    const origError = console.error
    console.error = (...args) => {
      errors.push(args.map(String).join(' '))
      origError(...args)
    }
    try {
      renderPage()
      // Wait for loading to finish — the "All Months" button only renders after data loads
      const allBtn = await screen.findByRole('button', { name: /all months/i }, { timeout: 5000 })

      // Click "All Months"
      expect(() => fireEvent.click(allBtn)).not.toThrow()

      // After clicking, the page should still be rendered (not blank) — assert the All Months button is still there
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /all months/i })).toBeInTheDocument()
      })
    } finally {
      console.error = origError
    }
    // No render-time React errors (the reference/initialization kind, not the
    // caught data-fetch TypeError that the page itself logs and recovers from).
    const renderErrors = errors.filter(e => /ReferenceError|Cannot access .* before initialization/.test(e))
    expect(renderErrors).toEqual([])
  })
})
