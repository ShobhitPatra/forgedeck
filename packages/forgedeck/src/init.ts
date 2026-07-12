/**
 * `forgedeck init` — the 60-second adoption path (spec addendum P3).
 *
 * Adoption for a standard tool lives or dies in the first sixty seconds. `init`
 * automates the four fumbles a developer would otherwise hit by hand — the shim
 * route, the next-config wrap, the config scaffold, the gitignore line — and then
 * runs the first build so the developer ends on the teaching table (their own
 * app's inventory) before they decide anything.
 *
 * ## Never mangle
 *
 * The one thing `init` must never do is guess wrong about a user's `next.config`.
 * Guessing at a config is how trust dies. So the wrap is attempted ONLY when the
 * shape is unambiguous — a plain `export default <object|identifier>` or
 * `module.exports = <object|identifier>`. Anything else (existing compositions
 * like `withSomething(...)` or `defineConfig(...)`, function configs) is left
 * untouched and the exact paste-line is printed instead.
 *
 * Every step is idempotent: a second run touches nothing and prints
 * "already set up ✓" per item. `init` NEVER touches git.
 *
 * ## First build (orchestrator deviation from P3's letter)
 *
 * P3 says init "runs the first build". `next build` in a real user project takes
 * minutes; instead `init` runs OUR fast structural compile (`runForgedeckExtraction`,
 * the same compile+voice code `withForgedeck()` runs inside `next build`). It
 * emits `.agent/` in seconds and — because no `.agent/` existed before — prints the
 * fuller first-build teaching table. Same teaching moment, sixty seconds not minutes.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runForgedeckExtraction } from './next/plugin.js'

// The version that first ships `forgedeck diff` (Task 5 / the review leg). The
// generated workflow calls `forgedeck diff`, which lands before launch; the YAML
// comment pins the minimum version so a too-old install fails loudly, not weirdly.
const DIFF_VERSION = '0.1.0'

// The ~5-line shim (spec D4: wiring, never logic). All behavior lives in the
// package; this file exists only because Next's file conventions require it to.
const SHIM = `import { createForgedeckHandler } from 'forgedeck/next'

export const { GET, POST } = createForgedeckHandler()
`

// The all-comments config scaffold. Only the import and the `defineConfig({})`
// call are live — everything else is commented examples that teach the allowlist:
// reads are exposed by default, mutations are LOCKED until named here.
const CONFIG_SCAFFOLD = `import { defineConfig } from 'forgedeck'

/**
 * forgedeck configuration.
 *
 * forgedeck is safe by default: every READ action is exposed to agents, and
 * every MUTATION is LOCKED until you enable it here by name. Nothing below is
 * required — the commented examples show the allowlist you opt into.
 */
export default defineConfig({
  // exclude: files or globs never extracted, never exposed.
  //   exclude: ['app/api/internal/**', 'app/api/debug/route.ts'],

  // enabledActions: the mutation allowlist. Mutations are locked by default;
  // name the exact ones agents may call. This is the most important line here —
  // adding a mutation is a deliberate, reviewable act.
  //   enabledActions: ['createOrder', 'updateCartQuantity'],

  // environments: per-environment overrides. An environment's enabledActions
  // REPLACES the base list wholesale.
  //   environments: { staging: { enabledActions: ['createOrder', 'refundOrder'] } },

  // bridges: generate typed Next.js route bridges for server actions so they are
  // reachable over HTTP by the agent surface.
  //   bridges: true,
})
`

function workflowYaml(): string {
  return `# forgedeck semantic diff — comments the agent-surface changes on every PR.
# requires forgedeck >= ${DIFF_VERSION} (the release that ships \`forgedeck diff\`).
name: forgedeck diff

on:
  pull_request:

jobs:
  forgedeck-diff:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install
      - run: npx forgedeck diff --base \${{ github.event.pull_request.base.sha }}
`
}

// --- injectable seams (real defaults; overridden in unit tests) ------------

export interface InitDeps {
  /** Where every human-facing line goes (console.log in production). */
  log: (msg: string) => void
  /** The first build — real default runs our fast structural compile + voice. */
  firstBuild: (projectDir: string) => Promise<void>
}

const defaultDeps: InitDeps = {
  log: (msg) => console.log(msg),
  firstBuild: (projectDir) => runForgedeckExtraction(projectDir),
}

export interface InitOptions {
  /** `--with-workflow`: also write the GitHub Action workflow. */
  withWorkflow?: boolean
}

// --- filesystem helpers ----------------------------------------------------

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * Resolve the App Router base directory, following Next's precedence: a root
 * `app/` wins over `src/app/` when both exist. Returns `null` when neither is
 * present (Pages-Router-only or non-Next project) — the caller bails politely.
 */
export function detectAppBase(projectDir: string): 'app' | 'src/app' | null {
  if (isDir(join(projectDir, 'app'))) return 'app'
  if (isDir(join(projectDir, 'src', 'app'))) return 'src/app'
  return null
}

// --- next.config wrap (never mangle) ---------------------------------------

type ConfigStyle = 'esm' | 'cjs'

const CONFIG_FILES = ['next.config.js', 'next.config.mjs', 'next.config.ts'] as const

function findConfigFile(projectDir: string): string | null {
  for (const name of CONFIG_FILES) if (existsSync(join(projectDir, name))) return name
  return null
}

/** Module style a config file's syntax should be preserved in. */
function styleOf(fileName: string, source: string): ConfigStyle {
  if (fileName.endsWith('.mjs') || fileName.endsWith('.ts')) return 'esm'
  // A bare `.js` may be either; the syntax already in the file is authoritative.
  if (/export\s+default/.test(source)) return 'esm'
  if (/module\.exports/.test(source)) return 'cjs'
  return 'cjs'
}

/**
 * Find the index just past the matching close brace for an object literal whose
 * open brace is at `str[0]`, skipping braces inside strings and comments so a
 * `{ basePath: '/}' }` does not fool us. Returns -1 if unbalanced (→ we bail to
 * the paste-line rather than risk mangling).
 */
function matchObjectLiteral(str: string): number {
  let depth = 0
  let i = 0
  const n = str.length
  while (i < n) {
    const c = str[i]
    const next = str[i + 1]
    if (c === '/' && next === '/') {
      i = str.indexOf('\n', i)
      if (i === -1) return -1
      continue
    }
    if (c === '/' && next === '*') {
      const end = str.indexOf('*/', i + 2)
      if (end === -1) return -1
      i = end + 2
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      i++
      while (i < n && str[i] !== c) {
        if (str[i] === '\\') i++
        i++
      }
      i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i + 1
    }
    i++
  }
  return -1
}

/**
 * Attempt to wrap a config source in `withForgedeck(...)`. Returns the rewritten
 * source only when the shape is UNAMBIGUOUS (`export default`/`module.exports =`
 * of a bare object literal or a bare identifier, as the last statement). Returns
 * `null` for everything else — compositions, function configs, trailing code —
 * so the caller prints the paste-line and leaves the file untouched.
 */
export function tryWrapConfig(source: string, style: ConfigStyle): string | null {
  const marker = style === 'esm' ? /export\s+default\s+/ : /module\.exports\s*=\s*/
  const m = marker.exec(source)
  if (!m) return null
  const rhsStart = m.index + m[0].length
  const rest = source.slice(rhsStart)

  // Identifier form: the entire remainder is a bare identifier (+ optional ; / ws).
  const idMatch = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*;?\s*$/.exec(rest)
  let rhsEnd: number
  if (idMatch) {
    rhsEnd = rhsStart + idMatch[1].length
  } else if (rest[0] === '{') {
    // Object-literal form: brace-match, and require only ; / ws to follow.
    const end = matchObjectLiteral(rest)
    if (end === -1) return null
    if (!/^\s*;?\s*$/.test(rest.slice(end))) return null
    rhsEnd = rhsStart + end
  } else {
    return null
  }

  const importLine =
    style === 'esm'
      ? `import { withForgedeck } from 'forgedeck/next'`
      : `const { withForgedeck } = require('forgedeck/next')`
  return `${importLine}\n${source.slice(0, rhsStart)}withForgedeck(${source.slice(rhsStart, rhsEnd)})${source.slice(rhsEnd)}`
}

function pasteLines(fileName: string, style: ConfigStyle): string[] {
  const [imp, wrap] =
    style === 'esm'
      ? [
          `  import { withForgedeck } from 'forgedeck/next'`,
          `  export default withForgedeck(/* your existing config */)`,
        ]
      : [
          `  const { withForgedeck } = require('forgedeck/next')`,
          `  module.exports = withForgedeck(/* your existing config */)`,
        ]
  return [
    `${fileName}: config shape not recognized — wrap it by hand (forgedeck never guesses at your config):`,
    imp,
    wrap,
  ]
}

// --- the init flow ---------------------------------------------------------

/**
 * Run `forgedeck init` against `projectDir`. Idempotent, non-interactive, and it
 * never touches git. Returns nothing; every outcome is reported via `deps.log`.
 */
export async function runInit(
  projectDir: string,
  options: InitOptions = {},
  deps: Partial<InitDeps> = {},
): Promise<void> {
  const { log, firstBuild } = { ...defaultDeps, ...deps }

  // Step 1 — detect App Router or bail politely.
  const appBase = detectAppBase(projectDir)
  if (!appBase) {
    log('forgedeck init currently supports Next.js App Router projects')
    return
  }

  // Step 2 — the shim route (only if absent).
  const shimRel = join(appBase, 'api', 'mcp', 'route.ts')
  const shimAbs = join(projectDir, shimRel)
  if (existsSync(shimAbs)) {
    log(`${shimRel}: already set up ✓`)
  } else {
    mkdirSync(dirname(shimAbs), { recursive: true })
    writeFileSync(shimAbs, SHIM)
    log(`✓ wrote ${shimRel}`)
  }

  // Step 3 — wrap next.config (only when unambiguous; else paste-line).
  const configFile = findConfigFile(projectDir)
  if (!configFile) {
    const created = 'next.config.mjs'
    writeFileSync(
      join(projectDir, created),
      `import { withForgedeck } from 'forgedeck/next'\n\nexport default withForgedeck({})\n`,
    )
    log(`✓ created ${created} (wrapped empty config)`)
  } else {
    const abs = join(projectDir, configFile)
    const source = readFileSync(abs, 'utf8')
    if (source.includes('withForgedeck')) {
      log(`${configFile}: already set up ✓`)
    } else {
      const style = styleOf(configFile, source)
      const wrapped = tryWrapConfig(source, style)
      if (wrapped) {
        writeFileSync(abs, wrapped)
        log(`✓ wrapped ${configFile} with withForgedeck()`)
      } else {
        for (const line of pasteLines(configFile, style)) log(line)
      }
    }
  }

  // Step 4 — the all-comments config scaffold (only if absent).
  const cfgAbs = join(projectDir, 'forgedeck.config.ts')
  if (existsSync(cfgAbs)) {
    log('forgedeck.config.ts: already set up ✓')
  } else {
    writeFileSync(cfgAbs, CONFIG_SCAFFOLD)
    log('✓ wrote forgedeck.config.ts')
  }

  // Step 5 — gitignore .agent/ (append, or create).
  const giAbs = join(projectDir, '.gitignore')
  if (existsSync(giAbs)) {
    const content = readFileSync(giAbs, 'utf8')
    const ignored = content.split('\n').some((l) => {
      const t = l.trim()
      return t === '.agent/' || t === '.agent'
    })
    if (ignored) {
      log('.gitignore: already set up ✓')
    } else {
      const prefix = content.length === 0 || content.endsWith('\n') ? '' : '\n'
      writeFileSync(giAbs, `${content}${prefix}.agent/\n`)
      log('✓ added .agent/ to .gitignore')
    }
  } else {
    writeFileSync(giAbs, '.agent/\n')
    log('✓ created .gitignore (ignoring .agent/)')
  }

  // Step 6 — the PR-diff workflow (opt-in via --with-workflow; else a hint).
  if (options.withWorkflow) {
    const wfRel = join('.github', 'workflows', 'forgedeck.yml')
    const wfAbs = join(projectDir, wfRel)
    if (existsSync(wfAbs)) {
      log(`${wfRel}: already set up ✓`)
    } else {
      mkdirSync(dirname(wfAbs), { recursive: true })
      writeFileSync(wfAbs, workflowYaml())
      log(`✓ wrote ${wfRel}`)
    }
  } else {
    log('hint: run `forgedeck init --with-workflow` to comment semantic diffs on every PR')
  }

  // Step 7 — the first build, so init ends on the teaching table.
  log('')
  await firstBuild(projectDir)
}
