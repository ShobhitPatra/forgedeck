import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('cli', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('prints version', () => {
    const out = execFileSync('pnpm', ['exec', 'tsx', 'src/cli.ts', '--version'], {
      encoding: 'utf8',
    })
    expect(out.trim()).toBe('0.0.1')
  })

  it('fails the build loudly and non-zero on a config error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fd-cli-'))
    dirs.push(dir)
    mkdirSync(join(dir, 'app', 'api', 'gadgets'), { recursive: true })
    writeFileSync(
      join(dir, 'app', 'api', 'gadgets', 'route.ts'),
      `export async function GET() { return Response.json([]) }`,
    )
    // Unknown config key -> ConfigError -> build failure.
    writeFileSync(join(dir, 'forgedeck.config.ts'), `export default { enabledAction: ['x'] }`)
    let status = 0
    let stderr = ''
    try {
      execFileSync('pnpm', ['exec', 'tsx', 'src/cli.ts', 'build', dir], { encoding: 'utf8' })
    } catch (err) {
      const e = err as { status?: number; stderr?: string }
      status = e.status ?? 0
      stderr = e.stderr ?? ''
    }
    expect(status).not.toBe(0)
    expect(stderr).toMatch(/did you mean 'enabledActions'/)
    expect(stderr).toContain('the one exception to forgedeck never breaking your build')
  })
})
