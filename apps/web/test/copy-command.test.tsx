import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CopyCommand } from '../components/copy-command'

describe('CopyCommand', () => {
  it('copies the exact command and confirms', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<CopyCommand command="npx forgedeck init" />)
    await userEvent.click(screen.getByRole('button', { name: /copy command/i }))
    expect(writeText).toHaveBeenCalledWith('npx forgedeck init')
    expect(await screen.findByText('Copied')).toBeTruthy()
  })
})
