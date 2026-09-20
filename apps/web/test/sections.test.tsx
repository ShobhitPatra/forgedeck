import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Evidence } from '../components/evidence'
import { Safety } from '../components/sections/safety'
import { copy } from '../content/copy'
import { evidenceExample } from '../content/evidence-example'

afterEach(cleanup)

describe('Safety', () => {
  it('colours each effect label with its own token and nothing else', () => {
    render(<Safety />)
    expect(screen.getByText('read').className).toContain('text-read')
    expect(screen.getByText('write').className).toContain('text-write')
    expect(screen.getByText('irreversible').className).toContain('text-irreversible')
    expect(screen.getByText('Mutations ship disabled').className).not.toMatch(
      /text-(read|write|irreversible)/,
    )
  })

  it('renders every safety claim', () => {
    render(<Safety />)
    for (const item of copy.safety.items) expect(screen.getByText(item.body)).toBeTruthy()
  })
})

describe('Evidence', () => {
  it('shows every field of the emitted tool, unedited', () => {
    const { container } = render(<Evidence />)
    const output = container.querySelectorAll('pre')[1]?.textContent ?? ''
    expect(output).toBe(JSON.stringify(evidenceExample.tool, null, 2))
  })

  it('marks the effect in its colour and the disabled flag as off', () => {
    render(<Evidence />)
    expect(screen.getByText('"irreversible"').className).toContain('text-irreversible')
    expect(screen.getByText('false').className).toContain('text-faint')
  })
})
