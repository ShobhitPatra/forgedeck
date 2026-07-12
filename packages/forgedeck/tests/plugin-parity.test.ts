import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, cpSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { withForgedeck, __resetForgedeckGuard } from '../src/next/plugin'
import { runBuild } from '../src/build'
import { ConfigError } from '../src/config/schema'

// Parity: a build driven by the `withForgedeck()` plugin must produce EXACTLY what
// `forgedeck build` (runBuild) produces — same bundle, same bridges, same storefront.
// The plugin no longer runs its own compile+emit: it delegates to the SAME runBuild
// the CLI does, so allowlist/bridges/storefront behave identically however the build
// is triggered. These tests prove that against a real fixture copy.

const PHASE_BUILD = 'phase-production-build'

const cleanups: string[] = []
function tracked(dir: string): string {
  cleanups.push(dir)
  return dir
}
afterAll(() => {
  for (const d of cleanups.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Copy a committed fixture into a throwaway tmp dir (the committed one is never touched). */
function copyFixture(src: string): string {
  const dir = tracked(mkdtempSync(join(tmpdir(), 'fd-parity-')))
  cpSync(src, dir, { recursive: true })
  return dir
}

/** Run `fn` with the process cwd temporarily set to `dir` (the plugin keys off cwd). */
async function inDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd()
  process.chdir(dir)
  try {
    return await fn()
  } finally {
    process.chdir(prev)
  }
}

/** Sorted list of every file under `<dir>/<sub>`, relative to that subtree (empty if absent). */
function listTree(dir: string, sub: string): string[] {
  const root = join(dir, sub)
  if (!existsSync(root)) return []
  const out: string[] = []
  const walk = (abs: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const child = join(abs, entry.name)
      if (entry.isDirectory()) walk(child)
      else out.push(relative(root, child).split('\\').join('/'))
    }
  }
  walk(root)
  return out.sort()
}

const BRIDGE_DIR = 'app/api/.agent'

// The hybrid-shop config that exercises all three surfaces at once: an allowlist (two
// enabled mutations), bridges (a server-action shim), and a public storefront.
const FULL_CONFIG =
  "import { defineConfig } from 'forgedeck'\n" +
  'export default defineConfig({\n' +
  "  enabledActions: ['post_documents', 'delete_survey'],\n" +
  '  bridges: true,\n' +
  '  public: true,\n' +
  '})\n'

describe('plugin build parity with cli build', () => {
  it('a plugin-driven build produces byte-identical bundle, bridges, and storefront to a cli build', async () => {
    const pluginDir = copyFixture('tests/fixtures/hybrid-shop')
    const cliDir = copyFixture('tests/fixtures/hybrid-shop')
    writeFileSync(join(pluginDir, 'forgedeck.config.ts'), FULL_CONFIG)
    writeFileSync(join(cliDir, 'forgedeck.config.ts'), FULL_CONFIG)

    // CLI leg: exactly what `forgedeck build` runs.
    await runBuild(cliDir, join(cliDir, '.agent'))

    // Plugin leg: the real withForgedeck config function on the build phase, keyed off cwd.
    await inDir(pluginDir, async () => {
      __resetForgedeckGuard()
      await withForgedeck({})(PHASE_BUILD)
    })

    for (const sub of ['.agent', '.agent-public', BRIDGE_DIR]) {
      const cliFiles = listTree(cliDir, sub)
      const pluginFiles = listTree(pluginDir, sub)
      // 1) file lists identical
      expect(pluginFiles, `file list mismatch under ${sub}`).toEqual(cliFiles)
      // 2) every file byte-identical
      for (const rel of cliFiles) {
        expect(
          readFileSync(join(pluginDir, sub, rel)),
          `content mismatch at ${sub}/${rel}`,
        ).toEqual(readFileSync(join(cliDir, sub, rel)))
      }
    }

    // The plugin actually emitted bridges AND a storefront (not vacuously equal-because-empty).
    expect(listTree(pluginDir, '.agent')).toContain('tools.json')
    expect(listTree(pluginDir, '.agent-public')).toContain('tools.json')
    expect(listTree(pluginDir, BRIDGE_DIR)).toContain('delete_survey/route.ts')
  })

  it('a ConfigError fails the build via the plugin (the one deliberate build-breaker)', async () => {
    const dir = copyFixture('tests/fixtures/hybrid-shop')
    // an unknown key — parseConfig rejects it with a did-you-mean ConfigError
    writeFileSync(
      join(dir, 'forgedeck.config.ts'),
      "import { defineConfig } from 'forgedeck'\nexport default defineConfig({ enabledAction: ['x'] })\n",
    )
    await inDir(dir, async () => {
      __resetForgedeckGuard()
      await expect(withForgedeck({})(PHASE_BUILD)).rejects.toThrowError(ConfigError)
      __resetForgedeckGuard()
      // the explanation (why config errors are the one exception) is attached
      await expect(withForgedeck({})(PHASE_BUILD)).rejects.toThrow(ConfigError.explanation)
    })
    // the failed build wrote no bundle — nothing to serve from a misread config
    expect(existsSync(join(dir, '.agent', 'tools.json'))).toBe(false)
  })
})
