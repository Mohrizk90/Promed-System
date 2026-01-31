import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: { getItem: () => 'en', setItem: () => {} },
      writable: true
    })
  })

  it('renders Promed branding', () => {
    render(<App />)
    expect(screen.getByText('Promed')).toBeInTheDocument()
  })

  it('renders navigation links', () => {
    render(<App />)
    expect(screen.getAllByRole('link', { name: /dashboard/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: /client transactions/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: /supplier transactions/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: /clients & suppliers/i }).length).toBeGreaterThan(0)
  })
})
