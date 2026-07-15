import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Safety } from '../components/sections/safety'

describe('Safety', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows the full effect triad on the labeling row', () => {
    render(<Safety />)
    // The "every action is labeled read, write, or irreversible" row carries all
    // three effect badges, not a single misleading one. ("write" also appears on
    // the mutations row, so it shows up twice.)
    expect(screen.getByText('read')).toBeTruthy()
    expect(screen.getAllByText('write').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('irreversible')).toBeTruthy()
  })

  it('renders neutral markers for non-effect rows', () => {
    render(<Safety />)
    const locked = screen.getByText('locked')
    const auth = screen.getByText('auth')
    // Neutral markers use the graphite palette, never an effect color.
    expect(locked.className).toContain('text-graphite')
    expect(locked.className).toContain('border-graphite')
    expect(auth.className).toContain('text-graphite')
    expect(auth.className).not.toContain('text-read')
    expect(auth.className).not.toContain('text-write')
  })
})
