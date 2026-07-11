import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('forgedeck build e2e', () => {
  it('builds a bundle from the fixture via the cli', () => {
    const out = mkdtempSync(join(tmpdir(), 'forgedeck-e2e-'))
    const stdout = execFileSync(
      'pnpm',
      ['exec', 'tsx', 'src/cli.ts', 'build', 'tests/fixtures/mini-shop', '--out', out],
      { encoding: 'utf8' },
    )
    expect(stdout).toContain('4 actions extracted')
    expect(existsSync(join(out, 'tools.json'))).toBe(true)
    const manifest = JSON.parse(readFileSync(join(out, 'tools.json'), 'utf8'))
    expect(manifest.tools.filter((t: { enabled: boolean }) => t.enabled)).toHaveLength(2)
  })
})
