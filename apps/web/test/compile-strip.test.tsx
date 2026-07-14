import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CompileStrip } from '../components/compile-strip'

function mockMatchMedia(reduced: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockReturnValue({
      matches: reduced,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  })
}

describe('CompileStrip', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', undefined)
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the final frame when reduced motion is preferred', () => {
    mockMatchMedia(true)
    render(<CompileStrip />)
    expect(screen.getByText('list_products')).toBeTruthy()
    expect(screen.getByText('read')).toBeTruthy()
  })

  it('renders the final frame when IntersectionObserver is unavailable', () => {
    mockMatchMedia(false)
    render(<CompileStrip />)
    expect(screen.getByText('list_products')).toBeTruthy()
  })

  it('always shows the source panel', () => {
    mockMatchMedia(true)
    render(<CompileStrip />)
    expect(screen.getByText('app/api/products/route.ts')).toBeTruthy()
  })
})
