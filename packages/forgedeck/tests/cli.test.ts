import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'

describe('cli', () => {
  it('prints version', () => {
    const out = execFileSync('pnpm', ['exec', 'tsx', 'src/cli.ts', '--version'], {
      encoding: 'utf8',
    })
    expect(out.trim()).toBe('0.0.1')
  })
})
