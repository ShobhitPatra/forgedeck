import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CopyCommand } from '../components/copy-command'

afterEach(cleanup)

describe('CopyCommand', () => {
  it('copies the exact command and confirms', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<CopyCommand command="npx forgedeck init" />)
    await userEvent.click(screen.getByRole('button', { name: /copy command/i }))
    expect(writeText).toHaveBeenCalledWith('npx forgedeck init')
    expect(await screen.findByText('Copied')).toBeTruthy()
  })

  it('shows a failure state when the clipboard write rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.assign(navigator, { clipboard: { writeText } })
    render(<CopyCommand command="npx forgedeck init" />)
    await userEvent.click(screen.getByRole('button', { name: /copy command/i }))
    expect(await screen.findByText('Copy failed')).toBeTruthy()
  })

  it('survives a rapid double-click without breaking', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<CopyCommand command="npx forgedeck init" />)
    const button = screen.getByRole('button', { name: /copy command/i })
    await userEvent.click(button)
    await userEvent.click(button)
    expect(writeText).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('Copied')).toBeTruthy()
  })
})
