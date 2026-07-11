import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { CoverageItem, SemanticIR } from '../ir/types.js'
import { ConfigError } from '../config/schema.js'
import type { ResolvedConfig } from '../config/load.js'
import { loadProject } from '../load/project.js'
import { loadMiddlewareMatchers, matcherCovers, type Matcher } from '../extract/auth.js'

export interface GenerateBridgesResult {
  /** Coverage notes ('bridge generated: <name>' / 'bridge removed: <name>') to fold
   * into the build's coverage report. */
  coverage: CoverageItem[]
  /** Tool names whose shim was (re)written this build. */
  generated: string[]
  /** Tool names whose stale shim was deleted this build. */
  removed: string[]
}

export interface GenerateBridgesOptions {
  /** Whether to touch the filesystem. The build sets this to `config.bridges === true`
   * (and never on a dry run). When false, generation is a no-op — bridges are a
   * generated artifact of the project tree, not something a read-only pass produces. */
  write: boolean
  /** Middleware matchers for the lock-4 coverage check. Injected by tests; when
   * omitted the project's middleware is loaded from `projectDir`. */
  matchers?: Matcher[]
}

// The URL a bridge shim answers on. Lock 4 checks that documented middleware auth
// still covers this path — a bridge must never be a door around the app's own gate.
function bridgePath(name: string): string {
  return `/api/.agent/${name}`
}

/**
 * The relative module specifier a shim uses to import the action function: from the
 * shim's own directory to the action's source file (extension stripped). POSIX
 * separators, always dot-prefixed so it reads as a relative import.
 */
export function bridgeImportPath(shimDirRel: string, sourceFileRel: string): string {
  const target = sourceFileRel.replace(/\.tsx?$/, '')
  let rel = relative(shimDirRel, target).split('\\').join('/')
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel
}

/**
 * The exact bytes of a bridge shim — wiring, not logic. It imports the package-side
 * handler, imports the action function by its export name via a computed relative
 * path, and wires POST. All safety (token, the app's own auth) lives in
 * `createBridgeHandler`; this file has nothing to get wrong.
 */
export function bridgeShim(exportName: string, importPath: string): string {
  return `import { createBridgeHandler } from 'forgedeck/bridge'
import { ${exportName} } from '${importPath}'
export const POST = createBridgeHandler(${exportName})
`
}

// Where bridge shims live in the target app: under the app-router tree so they are
// real Next.js route handlers. `.agent` is a dot-directory, so the extractor's glob
// (fast-glob, dot:false) never re-scans generated shims into the IR.
function agentRootDir(projectDir: string): string {
  const appDir =
    [join(projectDir, 'app'), join(projectDir, 'src', 'app')].find(existsSync) ??
    join(projectDir, 'app')
  return join(appDir, 'api', '.agent')
}

/**
 * Generate the bridge shims for a build, mirroring the allowlist onto disk.
 *
 * Lock 1 — existence mirrors the allowlist: a shim exists for exactly the enabled
 * SERVER ACTIONS (kind `server-action` enabled via the config allowlist; routes and
 * pages-api handlers already have HTTP addresses and never get one). Every build
 * byte-regenerates the current set and DELETES any `.agent` shim whose action is no
 * longer allowlisted.
 *
 * Lock 4 — middleware coverage: if a bridged action's auth was established by a
 * middleware matcher and no matcher covers `/api/.agent/*`, generation is a build
 * error (a bridge that dodges documented auth must never be written).
 *
 * Generation only happens when `opts.write` is true (the build passes
 * `config.bridges === true`); otherwise this is a no-op.
 */
export function generateBridges(
  ir: SemanticIR,
  config: ResolvedConfig | undefined,
  projectDir: string,
  opts: GenerateBridgesOptions,
): GenerateBridgesResult {
  const result: GenerateBridgesResult = { coverage: [], generated: [], removed: [] }
  if (!opts.write) return result

  // The bridge set: server actions the config allowlist deliberately enabled. A read
  // server action is `read-default`, never `config-allowlist`, so it never appears
  // here — existence mirrors the allowlist, not merely "enabled".
  const bridged = ir.actions.filter(
    (a) => a.kind === 'server-action' && a.enabledBy === 'config-allowlist',
  )

  // Middleware matchers are resolved lazily and once: only an action whose auth was
  // middleware-derived needs them, so a project with no such bridge never pays the
  // re-parse (nor requires a loadable project at all).
  let matchers: Matcher[] | undefined = opts.matchers
  const getMatchers = (): Matcher[] =>
    (matchers ??= loadMiddlewareMatchers(loadProject(projectDir)))

  // Lock 4 runs before any write so a coverage failure never leaves a half-written
  // shim tree behind.
  for (const a of bridged) {
    const authFromMiddleware = a.evidence.some((e) => e.includes('via middleware matcher'))
    if (authFromMiddleware && !matcherCovers(getMatchers(), bridgePath(a.name))) {
      throw new ConfigError(
        `bridge for ${a.name} would bypass documented auth: its auth comes from a middleware matcher, but no matcher covers /api/.agent/*. Fix: extend the matcher to cover /api/.agent/* or rely on in-action checks.`,
      )
    }
  }

  const agentRoot = agentRootDir(projectDir)
  const agentRootRel = relative(projectDir, agentRoot).split('\\').join('/')
  const desired = new Set(bridged.map((a) => a.name))

  // Lock 1 (removal half): drop shims for actions no longer allowlisted before
  // (re)writing the current set.
  if (existsSync(agentRoot)) {
    for (const entry of readdirSync(agentRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || desired.has(entry.name)) continue
      rmSync(join(agentRoot, entry.name), { recursive: true, force: true })
      result.removed.push(entry.name)
      result.coverage.push({
        file: `${agentRootRel}/${entry.name}/route.ts`,
        reason: `bridge removed: ${entry.name}`,
      })
    }
  }

  // Lock 1 (existence half): byte-regenerate the shim for every allowlisted server
  // action.
  for (const a of bridged) {
    const shimDir = join(agentRoot, a.name)
    const shimDirRel = relative(projectDir, shimDir).split('\\').join('/')
    const importPath = bridgeImportPath(shimDirRel, a.sourceFile)
    mkdirSync(shimDir, { recursive: true })
    writeFileSync(join(shimDir, 'route.ts'), bridgeShim(a.exportName, importPath))
    result.generated.push(a.name)
    result.coverage.push({
      file: `${shimDirRel}/route.ts`,
      reason: `bridge generated: ${a.name}`,
    })
  }

  return result
}
