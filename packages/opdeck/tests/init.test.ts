import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInit, tryWrapConfig, detectAppBase } from '../src/init'

// A no-op first build so unit tests exercise the scaffolding without a real
// compile. The real firstBuild (runOpdeckExtraction) is covered by the CLI
// integration test at the bottom.
function harness() {
  const logs: string[] = []
  let builds = 0
  return {
    logs,
    get builds() {
      return builds
    },
    deps: {
      log: (m: string) => logs.push(m),
      firstBuild: async () => {
        builds++
      },
    },
  }
}

/** Make a temp dir with a root App Router layout (`app/`). */
function appProject(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'fd-init-'))
  mkdirSync(join(dir, 'app'), { recursive: true })
  writeFileSync(join(dir, 'app', 'page.tsx'), 'export default function P() { return null }')
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  return dir
}

describe('opdeck init', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  const track = (d: string) => {
    dirs.push(d)
    return d
  }

  // --- bail path ----------------------------------------------------------

  it('bails politely when there is no App Router', async () => {
    const dir = track(mkdtempSync(join(tmpdir(), 'fd-init-')))
    mkdirSync(join(dir, 'pages')) // Pages Router only
    const h = harness()
    await runInit(dir, {}, h.deps)
    expect(h.logs).toEqual(['opdeck init currently supports Next.js App Router projects'])
    // Nothing was written.
    expect(existsSync(join(dir, 'opdeck.config.ts'))).toBe(false)
    expect(existsSync(join(dir, '.gitignore'))).toBe(false)
    expect(h.builds).toBe(0)
  })

  it('detectAppBase prefers root app/ over src/app/ and returns null otherwise', () => {
    const a = track(appProject())
    expect(detectAppBase(a)).toBe('app')
    const s = track(mkdtempSync(join(tmpdir(), 'fd-init-')))
    mkdirSync(join(s, 'src', 'app'), { recursive: true })
    expect(detectAppBase(s)).toBe('src/app')
    const n = track(mkdtempSync(join(tmpdir(), 'fd-init-')))
    expect(detectAppBase(n)).toBe(null)
  })

  // --- shim ---------------------------------------------------------------

  it('writes the 5-line shim (app layout) and ends on the first build', async () => {
    const dir = track(appProject())
    const h = harness()
    await runInit(dir, {}, h.deps)
    const shim = readFileSync(join(dir, 'app', 'api', 'mcp', 'route.ts'), 'utf8')
    expect(shim).toContain(`import { createOpdeckHandler } from 'opdeck/next'`)
    expect(shim).toContain('export const { GET, POST } = createOpdeckHandler()')
    expect(h.builds).toBe(1)
    expect(h.logs).toContain('✓ wrote app/api/mcp/route.ts')
  })

  it('respects the src/app layout for the shim', async () => {
    const dir = track(mkdtempSync(join(tmpdir(), 'fd-init-')))
    mkdirSync(join(dir, 'src', 'app'), { recursive: true })
    const h = harness()
    await runInit(dir, {}, h.deps)
    expect(existsSync(join(dir, 'src', 'app', 'api', 'mcp', 'route.ts'))).toBe(true)
    expect(existsSync(join(dir, 'app'))).toBe(false)
    expect(h.logs).toContain('✓ wrote src/app/api/mcp/route.ts')
  })

  // --- next.config wrap ---------------------------------------------------

  it('wraps a CJS object-literal config (module.exports = {})', async () => {
    const dir = track(appProject({ 'next.config.js': 'module.exports = {}\n' }))
    const h = harness()
    await runInit(dir, {}, h.deps)
    const out = readFileSync(join(dir, 'next.config.js'), 'utf8')
    expect(out).toContain(`const { withOpdeck } = require('opdeck/next')`)
    expect(out).toContain('module.exports = withOpdeck({})')
    expect(h.logs).toContain('✓ wrapped next.config.js with withOpdeck()')
  })

  it('wraps an ESM object-literal config (.mjs export default {…})', async () => {
    const dir = track(
      appProject({ 'next.config.mjs': 'export default {\n  reactStrictMode: true,\n}\n' }),
    )
    await runInit(dir, {}, harness().deps)
    const out = readFileSync(join(dir, 'next.config.mjs'), 'utf8')
    expect(out).toContain(`import { withOpdeck } from 'opdeck/next'`)
    expect(out).toContain('export default withOpdeck({\n  reactStrictMode: true,\n})')
  })

  it('wraps an identifier config (export default nextConfig)', async () => {
    const src = 'const nextConfig = { reactStrictMode: true }\nexport default nextConfig\n'
    const dir = track(appProject({ 'next.config.mjs': src }))
    await runInit(dir, {}, harness().deps)
    const out = readFileSync(join(dir, 'next.config.mjs'), 'utf8')
    expect(out).toContain('const nextConfig = { reactStrictMode: true }')
    expect(out).toContain('export default withOpdeck(nextConfig)')
  })

  it('creates next.config.mjs (wrapped empty) when no config exists', async () => {
    const dir = track(appProject())
    const h = harness()
    await runInit(dir, {}, h.deps)
    const out = readFileSync(join(dir, 'next.config.mjs'), 'utf8')
    expect(out).toContain(`import { withOpdeck } from 'opdeck/next'`)
    expect(out).toContain('export default withOpdeck({})')
    expect(h.logs).toContain('✓ created next.config.mjs (wrapped empty config)')
  })

  it('never mangles an ambiguous (composed) config — prints the paste-line, leaves it untouched', async () => {
    const composed = `const { compose } = require('./lib/compose')\nmodule.exports = compose({ reactStrictMode: true })\n`
    const dir = track(appProject({ 'next.config.js': composed }))
    const h = harness()
    await runInit(dir, {}, h.deps)
    // File is BYTE-for-byte unchanged.
    expect(readFileSync(join(dir, 'next.config.js'), 'utf8')).toBe(composed)
    // The paste-line was printed instead.
    expect(h.logs.some((l) => l.includes('config shape not recognized'))).toBe(true)
    expect(h.logs.some((l) => l.includes(`module.exports = withOpdeck(`))).toBe(true)
  })

  it('never mangles a function config (export default (phase) => …)', async () => {
    const fn = 'export default (phase) => ({ reactStrictMode: phase === "x" })\n'
    const dir = track(appProject({ 'next.config.mjs': fn }))
    const h = harness()
    await runInit(dir, {}, h.deps)
    expect(readFileSync(join(dir, 'next.config.mjs'), 'utf8')).toBe(fn)
    expect(h.logs.some((l) => l.includes('config shape not recognized'))).toBe(true)
    expect(h.logs.some((l) => l.includes('export default withOpdeck('))).toBe(true)
  })

  it('never mangles a defineConfig(...) call config', async () => {
    const dc = `import { defineConfig } from 'next/config'\nexport default defineConfig({ reactStrictMode: true })\n`
    const dir = track(appProject({ 'next.config.ts': dc }))
    const h = harness()
    await runInit(dir, {}, h.deps)
    expect(readFileSync(join(dir, 'next.config.ts'), 'utf8')).toBe(dc)
    expect(h.logs.some((l) => l.includes('config shape not recognized'))).toBe(true)
  })

  // --- opdeck.config.ts scaffold --------------------------------------

  it('scaffolds an all-comments opdeck.config.ts', async () => {
    const dir = track(appProject())
    await runInit(dir, {}, harness().deps)
    const cfg = readFileSync(join(dir, 'opdeck.config.ts'), 'utf8')
    expect(cfg).toContain(`import { defineConfig } from 'opdeck'`)
    expect(cfg).toContain('export default defineConfig({')
    // The only non-comment lines inside the call: teaching examples are commented.
    expect(cfg).toContain('// enabledActions:')
    expect(cfg).toContain('// exclude:')
    expect(cfg).toContain('// environments:')
    expect(cfg).toContain('// bridges:')
  })

  // --- .gitignore ---------------------------------------------------------

  it('appends .agent/ to an existing .gitignore without a trailing newline', async () => {
    const dir = track(appProject({ '.gitignore': 'node_modules\n.next' }))
    const h = harness()
    await runInit(dir, {}, h.deps)
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8')
    expect(gi).toBe('node_modules\n.next\n.agent/\n')
    expect(h.logs).toContain('✓ added .agent/ to .gitignore')
  })

  it('creates .gitignore when absent', async () => {
    const dir = track(appProject())
    const h = harness()
    await runInit(dir, {}, h.deps)
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe('.agent/\n')
    expect(h.logs).toContain('✓ created .gitignore (ignoring .agent/)')
  })

  it('leaves .gitignore alone when .agent/ is already ignored', async () => {
    const dir = track(appProject({ '.gitignore': 'node_modules\n.agent/\n' }))
    const h = harness()
    await runInit(dir, {}, h.deps)
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe('node_modules\n.agent/\n')
    expect(h.logs).toContain('.gitignore: already set up ✓')
  })

  // --- --with-workflow ----------------------------------------------------

  it('prints only a hint without --with-workflow', async () => {
    const dir = track(appProject())
    const h = harness()
    await runInit(dir, {}, h.deps)
    expect(existsSync(join(dir, '.github', 'workflows', 'opdeck.yml'))).toBe(false)
    expect(h.logs.some((l) => l.includes('--with-workflow'))).toBe(true)
  })

  it('writes the diff workflow with --with-workflow', async () => {
    const dir = track(appProject())
    const h = harness()
    await runInit(dir, { withWorkflow: true }, h.deps)
    const yml = readFileSync(join(dir, '.github', 'workflows', 'opdeck.yml'), 'utf8')
    expect(yml).toContain('on:\n  pull_request:')
    expect(yml).toContain('fetch-depth: 0')
    expect(yml).toContain('actions/setup-node@v4')
    expect(yml).toContain('npx opdeck diff --base ${{ github.event.pull_request.base.sha }}')
    expect(yml).toContain('requires opdeck >=')
    expect(h.logs).toContain('✓ wrote .github/workflows/opdeck.yml')
  })

  // --- idempotency --------------------------------------------------------

  it('is idempotent: a second run changes nothing and reports "already set up ✓"', async () => {
    const dir = track(appProject({ 'next.config.js': 'module.exports = {}\n' }))
    await runInit(dir, { withWorkflow: true }, harness().deps)

    // Snapshot every scaffold after the first run.
    const paths = [
      'app/api/mcp/route.ts',
      'next.config.js',
      'opdeck.config.ts',
      '.gitignore',
      '.github/workflows/opdeck.yml',
    ]
    const before = paths.map((p) => readFileSync(join(dir, p), 'utf8'))

    const h = harness()
    await runInit(dir, { withWorkflow: true }, h.deps)
    const after = paths.map((p) => readFileSync(join(dir, p), 'utf8'))
    expect(after).toEqual(before) // byte-identical: nothing mangled on re-run

    for (const marker of [
      'app/api/mcp/route.ts: already set up ✓',
      'next.config.js: already set up ✓',
      'opdeck.config.ts: already set up ✓',
      '.gitignore: already set up ✓',
      '.github/workflows/opdeck.yml: already set up ✓',
    ]) {
      expect(h.logs).toContain(marker)
    }
  })
})

// --- tryWrapConfig unit table ---------------------------------------------

describe('tryWrapConfig', () => {
  it('wraps bare object literals and identifiers, rejects everything else', () => {
    expect(tryWrapConfig('module.exports = {}\n', 'cjs')).toContain(
      'module.exports = withOpdeck({})',
    )
    expect(tryWrapConfig('export default {}\n', 'esm')).toContain('export default withOpdeck({})')
    expect(tryWrapConfig('export default cfg\n', 'esm')).toContain('export default withOpdeck(cfg)')
    // Ambiguous shapes → null (never mangle).
    expect(tryWrapConfig('export default defineConfig({})\n', 'esm')).toBe(null)
    expect(tryWrapConfig('module.exports = compose({})\n', 'cjs')).toBe(null)
    expect(tryWrapConfig('export default () => ({})\n', 'esm')).toBe(null)
    // A trailing statement after the export → refuse.
    expect(tryWrapConfig('export default {}\nconsole.log(1)\n', 'esm')).toBe(null)
    // Brace hidden in a string must not fool the matcher.
    expect(tryWrapConfig(`export default { a: '}' }\n`, 'esm')).toContain(
      `export default withOpdeck({ a: '}' })`,
    )
  })
})

// --- CLI integration: the real first build ends on the teaching table ------

describe('opdeck init (CLI, real build)', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('runs end-to-end on a mini-shop copy and prints the teaching table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fd-init-cli-'))
    dirs.push(dir)
    cpSync(join(__dirname, 'fixtures', 'mini-shop'), dir, { recursive: true })
    // Start clean: remove any prebuilt .agent so this is a genuine first build.
    rmSync(join(dir, '.agent'), { recursive: true, force: true })

    const stdout = execFileSync('pnpm', ['exec', 'tsx', 'src/cli/index.ts', 'init', dir], {
      encoding: 'utf8',
    })

    // Scaffolding happened on the copy (fixture untouched).
    expect(existsSync(join(dir, 'app', 'api', 'mcp', 'route.ts'))).toBe(true)
    expect(existsSync(join(dir, 'opdeck.config.ts'))).toBe(true)
    // The fixture's `module.exports = {}` was wrapped.
    expect(readFileSync(join(dir, 'next.config.js'), 'utf8')).toContain(
      'module.exports = withOpdeck({})',
    )
    // Init ended on the first-build teaching moment: the one-line voice + table.
    expect(stdout).toContain('opdeck ✓')
    expect(stdout).toContain('actions by kind')
    expect(existsSync(join(dir, '.agent', 'tools.json'))).toBe(true)
  }, 30000)
})
