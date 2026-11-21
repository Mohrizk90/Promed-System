import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

// Without a session the app must land on the sign-in screen (every business page is protected).
describe('App', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: { getItem: (k) => (k === 'language' ? 'en' : null), setItem: () => {}, removeItem: () => {} },
      writable: true,
    })
  })

  it('shows the sign-in screen when nobody is logged in', async () => {
    render(<App />)
    expect(await screen.findByText(/sign in with your promed account/i)).toBeInTheDocument()
    expect(screen.getByAltText(/promed/i)).toBeInTheDocument()
  })

  it('does not render protected navigation before sign-in', async () => {
    render(<App />)
    await screen.findByText(/sign in with your promed account/i)
    expect(screen.queryByRole('link', { name: /client transactions/i })).toBeNull()
  })
})
