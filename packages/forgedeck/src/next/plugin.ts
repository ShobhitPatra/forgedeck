/**
 * `withForgedeck()` — the SYNC leg (spec D1, plan addendum P2/P6).
 *
 * Wraps a Next.js config so the agent bundle is regenerated inside every
 * `next build`. Sync stops being a workflow you remember and becomes a
 * structural property of the build: the app cannot ship without the `.agent/`
 * surface being recompiled from the same source the app itself is built from.
 *
 * ## Mechanism: async config-phase function (NOT a webpack hook)
 *
 * `withForgedeck(nextConfig)` returns an **async config function**
 * `(phase) => Promise<NextConfig>`. Next.js supports a function default export
 * from `next.config.js` and `await`s it, passing the build PHASE as the first
 * argument (verified against Next 15.3.2: `next/constants` exports
 * `PHASE_PRODUCTION_BUILD = 'phase-production-build'` and
 * `PHASE_DEVELOPMENT_SERVER = 'phase-development-server'`).
 *
 * We deliberately do NOT drive the compile from a `config.webpack` wrapper.
 * `compile()` is async (ts-morph project load + Prisma read + emit), and Next's
 * webpack-config callback is treated as synchronous — there is no reliable point
 * inside it to `await` an async compile before the bundle is traced. The
 * config-phase function is the one place Next guarantees to await, so the
 * `.agent/` files are on disk before file tracing runs. This is what makes the
 * serverless tracing story (below) actually work.
 *
 * Because Next may evaluate the config more than once per invocation, the compile
 * is guarded to run **exactly once per build** via a `globalThis` flag keyed by
 * project directory (a single `next build` is one process, so once-per-process is
 * once-per-build). The guard also keeps `next dev` from recompiling on every
 * config re-read (debounced dev-watch regeneration is deferred to a later task).
 *
 * ## What the returned config always carries: serverless file tracing (P6)
 *
 * The `/api/mcp` route reads the compiled bundle from `.agent/` at runtime. On
 * Vercel-class serverless deploys, only files Next's output file tracing detects
 * are shipped into the lambda — and it cannot see a data directory the route
 * reads by path. So `withForgedeck` merges
 * `outputFileTracingIncludes['/api/mcp']` with `./.agent/**\/*`, UNIONing with any
 * user-provided entries rather than clobbering them. Only config-resident code
 * can wire this automatically, which is the core reason the plugin is flagship
 * over the `forgedeck build && next build` escape hatch. This merge is applied on
 * EVERY phase, even when the compile is skipped or fails — a last-good `.agent/`
 * must still be traced into the deploy.
 *
 * ## Never break the build (D1)
 *
 * Extraction failure never fails the build: it prints a loud warning, leaves any
 * existing (last-good) `.agent/` untouched, and returns the config unchanged so
 * the app still deploys. The SOLE exception is a `ConfigError` from config
 * parsing — shipping with misread authorization config is worse than not
 * shipping, so that rethrows and fails the build with its explanation.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runBuild as realRunBuild, type BuildResult } from '../build.js'
import { ConfigError } from '../config/schema.js'
import type { ActionIR, SemanticIR } from '../ir/types.js'

// Next build phases (public, stable string constants — inlined so the plugin
// takes no build-time dependency on the `next` package's types).
const PHASE_PRODUCTION_BUILD = 'phase-production-build'
const PHASE_DEVELOPMENT_SERVER = 'phase-development-server'

/** The `/api/mcp` tracing key and the globs that wire the bundle(s) into it. The public
 * bundle glob is ALWAYS included — it is safe when absent (an empty include) and is what
 * lets a traced serverless deploy serve the token-free storefront. */
const TRACING_ROUTE = '/api/mcp'
const TRACING_GLOBS = ['./.agent/**/*', './.agent-public/**/*']

/**
 * A minimal structural view of a Next.js config. We only touch
 * `outputFileTracingIncludes`; every other key is preserved verbatim. Typed
 * loosely (an index signature) so a real `NextConfig` assigns without importing
 * `next`.
 */
export type NextConfig = Record<string, unknown> & {
  outputFileTracingIncludes?: Record<string, string[]>
}

/** The async config function Next calls with the build phase. */
export type ForgedeckConfigFn = (phase: string, context?: unknown) => Promise<NextConfig>

/**
 * Merge the `/api/mcp` -> `./.agent/**\/*` (+ `./.agent-public/**\/*`) tracing entries
 * into a Next config WITHOUT clobbering user values: other `outputFileTracingIncludes`
 * keys are kept, and any existing entries for `/api/mcp` are preserved (each of our
 * globs is appended only if absent). Returns a new object; the input is not mutated.
 */
export function mergeForgedeckTracing(config: NextConfig): NextConfig {
  const existing = config.outputFileTracingIncludes ?? {}
  const forRoute = existing[TRACING_ROUTE] ?? []
  const merged = [...forRoute]
  for (const glob of TRACING_GLOBS) if (!merged.includes(glob)) merged.push(glob)
  return {
    ...config,
    outputFileTracingIncludes: { ...existing, [TRACING_ROUTE]: merged },
  }
}

// --- once-per-build guard -------------------------------------------------

const GUARD = Symbol.for('forgedeck.plugin.compiled')

function alreadyCompiled(projectDir: string): boolean {
  const g = globalThis as unknown as Record<symbol, Set<string> | undefined>
  let seen = g[GUARD]
  if (!seen) {
    seen = new Set<string>()
    g[GUARD] = seen
  }
  if (seen.has(projectDir)) return true
  seen.add(projectDir)
  return false
}

/** Test-only: clear the once-per-build guard so a fresh build can be simulated. */
export function __resetForgedeckGuard(): void {
  const g = globalThis as unknown as Record<symbol, Set<string> | undefined>
  g[GUARD] = undefined
}

// --- injectable dependencies (real defaults; overridden in unit tests) ----

export interface ForgedeckPluginDeps {
  /** The SHARED build orchestrator — the same `runBuild` the `forgedeck build` CLI
   * runs. Injecting the whole build (rather than compile/emit separately) is what
   * makes the plugin a first-class build: config load, allowlist, bridges, and the
   * public storefront are all applied identically however the build is triggered. */
  build: (projectDir: string, outDir: string) => Promise<BuildResult>
  agentDirExists: (outDir: string) => boolean
  log: (msg: string) => void
  warn: (msg: string) => void
}

const defaultDeps: ForgedeckPluginDeps = {
  build: realRunBuild,
  agentDirExists: (outDir) => existsSync(outDir),
  log: (msg) => console.log(msg),
  warn: (msg) => console.warn(msg),
}

// --- the build voice (addendum P2) ----------------------------------------

interface BuildStats {
  actions: number
  readsEnabled: number
  mutationsLocked: number
  entities: number
  warnings: string[]
}

// Warnings surfaced to the build log: every coverage note the compiler recorded,
// plus the two synthesized WARN classes `forgedeck coverage` reports (a write with
// no input contract, and a write whose auth could not be determined). The count is
// W in the one-line voice; up to 5 are echoed, then a pointer to the full report.
function collectWarnings(ir: SemanticIR): string[] {
  const lines: string[] = []
  for (const s of ir.coverage.skipped) lines.push(`${s.file}: ${s.reason}`)
  for (const a of ir.actions)
    if (a.effect !== 'read' && a.inputs.length === 0)
      lines.push(`${a.name}: write action with no input contract`)
  for (const a of ir.actions)
    if (a.effect !== 'read' && a.auth === 'unknown') lines.push(`${a.name}: auth unknown`)
  return lines
}

function summarize(ir: SemanticIR): BuildStats {
  return {
    actions: ir.actions.length,
    // Reads are enabled by the safety default; mutations are locked unless the
    // committed allowlist enabled them. An allowlisted (enabled) mutation is in
    // neither bucket — the parenthetical describes the two default postures.
    readsEnabled: ir.actions.filter((a) => a.enabled && a.effect === 'read').length,
    mutationsLocked: ir.actions.filter((a) => a.effect !== 'read' && !a.enabled).length,
    entities: ir.entities.length,
    warnings: collectWarnings(ir),
  }
}

// The exact one-line voice from addendum P2, printed on every steady-state build.
function oneLine(s: BuildStats): string {
  return `forgedeck ✓ ${s.actions} actions (${s.readsEnabled} reads enabled, ${s.mutationsLocked} mutations locked) · ${s.entities} entities · ${s.warnings.length} warnings → .agent/`
}

function steadyStateVoice(ir: SemanticIR): string {
  const s = summarize(ir)
  const out = [oneLine(s)]
  const shown = s.warnings.slice(0, 5)
  for (const w of shown) out.push(`  ! ${w}`)
  if (s.warnings.length > shown.length) {
    out.push(
      `  … +${s.warnings.length - shown.length} more — run \`forgedeck coverage\` for the full report`,
    )
  } else if (s.warnings.length > 0) {
    out.push('  run `forgedeck coverage` for the full report')
  }
  return out.join('\n')
}

// The fuller teaching table printed the FIRST time a build runs (no prior
// `.agent/`): actions by kind, the locked mutations with their reason, the auth
// histogram, and two next-step pointers.
function teachingTable(ir: SemanticIR): string {
  const s = summarize(ir)
  const byKind = (k: ActionIR['kind']) => ir.actions.filter((a) => a.kind === k).length
  const auth = (v: ActionIR['auth']) => ir.actions.filter((a) => a.auth === v).length
  const locked = ir.actions.filter((a) => a.effect !== 'read' && !a.enabled)

  const lines = [
    oneLine(s),
    '',
    `  actions by kind: ${byKind('route')} route · ${byKind('server-action')} server-action · ${byKind('pages-api')} pages-api`,
    '  locked mutations:',
  ]
  const CAP = 12
  if (locked.length === 0) {
    lines.push('    (none — every action is a read, enabled by default)')
  } else {
    for (const a of locked.slice(0, CAP))
      lines.push(`    - ${a.name} (${a.effect} locked by default — enable in forgedeck.config.ts)`)
    if (locked.length > CAP) lines.push(`    … +${locked.length - CAP} more`)
  }
  lines.push(
    `  auth: ${auth('required')} required · ${auth('unknown')} unknown · ${auth('none')} none`,
  )
  lines.push('')
  lines.push('  next: run `forgedeck coverage` for the full authorization report')
  lines.push('  next: enable specific mutations by name in forgedeck.config.ts')
  return lines.join('\n')
}

function failureBanner(err: unknown): string {
  const reason = err instanceof Error ? err.message : String(err)
  return [
    '',
    '⚠ forgedeck: agent extraction FAILED — the build continues, last-good .agent/ kept.',
    `  reason: ${reason}`,
    '  the app still deploys; the agent surface is unchanged from the last successful build.',
    '  run `forgedeck build` locally to see the full error.',
    '',
  ].join('\n')
}

// --- the extraction core (called once per build) --------------------------

/**
 * Run the SHARED build orchestrator (`runBuild`) against the project and print the
 * build voice from the IR it produced. Isolated from the guard/phase logic so unit
 * tests can drive it directly with a mocked `build`.
 *
 * This is where plugin/CLI parity is enforced: the plugin does NOT run its own
 * compile+emit. It calls the identical `runBuild` the CLI does — config load,
 * allowlist, bridge generation/retirement (gated on `bridges: true`), and the pruned
 * `.agent-public/` storefront (emitted/retired per the `public` config) all happen
 * exactly as they do for `forgedeck build`. The plugin keeps only its own concerns:
 * the once-per-build guard, the worker skip, the tracing merge, and this voice.
 *
 * - `ConfigError` from the build is RETHROWN (with the explanation ensured in the
 *   message): a config parse error is the one deliberate build-breaker.
 * - Any other failure is swallowed: a loud warning is printed, the build wrote
 *   nothing new (so an existing last-good `.agent/` is left untouched), and control
 *   returns normally so the caller returns the config and the build proceeds.
 */
export async function runForgedeckExtraction(
  projectDir: string,
  deps: ForgedeckPluginDeps = defaultDeps,
): Promise<void> {
  const outDir = join(projectDir, '.agent')
  const firstBuild = !deps.agentDirExists(outDir)

  let result: BuildResult
  try {
    result = await deps.build(projectDir, outDir)
  } catch (err) {
    if (err instanceof ConfigError) {
      if (!err.message.includes(ConfigError.explanation)) {
        err.message = `${err.message}\n${ConfigError.explanation}`
      }
      throw err
    }
    deps.warn(failureBanner(err))
    return
  }

  deps.log(firstBuild ? teachingTable(result.ir) : steadyStateVoice(result.ir))
}

/**
 * Wrap a Next.js config so `next build` recompiles the agent bundle and traces
 * `.agent/` into the `/api/mcp` route's serverless output.
 *
 * Returns an async config function `(phase) => Promise<NextConfig>`:
 * - the tracing merge is applied on every phase;
 * - on a build/dev-start phase, the compile+emit+voice runs exactly once per
 *   build (guarded per project directory).
 *
 * @param nextConfig the user's Next config (object form). Preserved verbatim
 *   apart from the merged `outputFileTracingIncludes`.
 * @param deps injectable dependencies — real defaults; overridden only in tests.
 */
export function withForgedeck(
  nextConfig: NextConfig = {},
  deps: ForgedeckPluginDeps = defaultDeps,
): ForgedeckConfigFn {
  return async (phase: string): Promise<NextConfig> => {
    const merged = mergeForgedeckTracing(nextConfig)
    const isBuildPhase = phase === PHASE_PRODUCTION_BUILD || phase === PHASE_DEVELOPMENT_SERVER
    // Next spawns WORKER processes (page-data collection, static generation) that
    // each re-evaluate next.config.js with the build phase — so the per-process
    // guard alone still compiles once per worker (~4x per build, observed in the
    // skeleton e2e). Workers mark themselves with IS_NEXT_WORKER=true (set in
    // next/dist/lib/worker.js); the main build process compiles BEFORE any worker
    // spawns, so workers only ever need the config, never the compile.
    const isWorker = process.env.IS_NEXT_WORKER === 'true'
    if (isBuildPhase && !isWorker) {
      const projectDir = process.cwd()
      if (!alreadyCompiled(projectDir)) {
        await runForgedeckExtraction(projectDir, deps)
      }
    }
    return merged
  }
}
