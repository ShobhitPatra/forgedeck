import { describe, it, expect, beforeEach } from 'vitest'
import {
  withForgedeck,
  mergeForgedeckTracing,
  runForgedeckExtraction,
  __resetForgedeckGuard,
  type ForgedeckPluginDeps,
  type NextConfig,
} from '../src/next/plugin'
import { ConfigError } from '../src/config/schema'
import type { ActionIR, EntityIR, SemanticIR } from '../src/ir/types'

const PHASE_BUILD = 'phase-production-build'
const PHASE_RUNTIME = 'phase-production-server'

// --- IR builders ----------------------------------------------------------

function action(over: Partial<ActionIR>): ActionIR {
  return {
    name: 'a',
    kind: 'route',
    sourceFile: 'app/api/a/route.ts',
    exportName: 'GET',
    description: 'an action',
    inputs: [],
    effect: 'read',
    entitiesTouched: [],
    enabled: true,
    enabledBy: 'read-default',
    confidence: 'static',
    auth: 'none',
    preconditions: [],
    evidence: [],
    ...over,
  }
}

function entity(name: string): EntityIR {
  return { name, fields: [], relations: [], sourceFile: 'schema.prisma' }
}

function ir(over: Partial<SemanticIR> = {}): SemanticIR {
  return {
    app: { name: 'shop', framework: 'nextjs-app-router' },
    entities: [entity('Product'), entity('Order')],
    actions: [
      action({ name: 'get_products', effect: 'read', enabled: true, enabledBy: 'read-default' }),
      action({
        name: 'post_orders',
        effect: 'write',
        enabled: false,
        enabledBy: undefined,
        auth: 'required',
        inputs: [{ name: 'items', type: 'string', required: true, location: 'body' }],
      }),
      action({
        name: 'delete_cart',
        kind: 'server-action',
        effect: 'irreversible',
        enabled: false,
        enabledBy: undefined,
        auth: 'required',
      }),
    ],
    workflows: [],
    coverage: { extracted: 3, skipped: [] },
    ...over,
  }
}

type RecordingDeps = ForgedeckPluginDeps & {
  logs: string[]
  warns: string[]
  readonly compileCalls: number
  readonly emitCalls: number
}

// A deps double that records log/warn output and counts compile/emit calls.
// Live getters (not a snapshot) keep the counts current as the closures run.
function makeDeps(over: Partial<ForgedeckPluginDeps> = {}): RecordingDeps {
  const logs: string[] = []
  const warns: string[] = []
  const counts = { compileCalls: 0, emitCalls: 0 }
  const base: ForgedeckPluginDeps = {
    compile: async () => {
      counts.compileCalls++
      return ir()
    },
    emitBundle: () => {
      counts.emitCalls++
      return []
    },
    agentDirExists: () => true,
    log: (m) => logs.push(m),
    warn: (m) => warns.push(m),
    ...over,
  }
  return Object.defineProperties(base, {
    logs: { value: logs, enumerable: true },
    warns: { value: warns, enumerable: true },
    compileCalls: { get: () => counts.compileCalls, enumerable: true },
    emitCalls: { get: () => counts.emitCalls, enumerable: true },
  }) as RecordingDeps
}

beforeEach(() => __resetForgedeckGuard())

// --- tracing merge --------------------------------------------------------

describe('mergeForgedeckTracing', () => {
  it('injects /api/mcp -> .agent glob into an empty config', () => {
    const merged = mergeForgedeckTracing({})
    expect(merged.outputFileTracingIncludes).toEqual({
      '/api/mcp': ['./.agent/**/*', './.agent-public/**/*'],
    })
  })

  it('preserves other tracing keys and existing /api/mcp entries (no clobber)', () => {
    const input: NextConfig = {
      reactStrictMode: true,
      outputFileTracingIncludes: {
        '/api/other': ['./data/**/*'],
        '/api/mcp': ['./custom/**/*'],
      },
    }
    const merged = mergeForgedeckTracing(input)
    expect(merged.reactStrictMode).toBe(true)
    expect(merged.outputFileTracingIncludes).toEqual({
      '/api/other': ['./data/**/*'],
      '/api/mcp': ['./custom/**/*', './.agent/**/*', './.agent-public/**/*'],
    })
    // input is not mutated
    expect(input.outputFileTracingIncludes!['/api/mcp']).toEqual(['./custom/**/*'])
  })

  it('is idempotent — does not duplicate the glob if already present', () => {
    const once = mergeForgedeckTracing({})
    const twice = mergeForgedeckTracing(once)
    expect(twice.outputFileTracingIncludes!['/api/mcp']).toEqual([
      './.agent/**/*',
      './.agent-public/**/*',
    ])
  })

  it('withForgedeck returns a config carrying the tracing merge on any phase', async () => {
    const fn = withForgedeck({ reactStrictMode: true }, makeDeps())
    const cfg = await fn(PHASE_RUNTIME)
    expect(cfg.reactStrictMode).toBe(true)
    expect(cfg.outputFileTracingIncludes).toEqual({
      '/api/mcp': ['./.agent/**/*', './.agent-public/**/*'],
    })
  })
})

// --- once-per-build guard -------------------------------------------------

describe('once-per-build guard', () => {
  it('compiles exactly once across repeated config evaluations in a build', async () => {
    const deps = makeDeps()
    const fn = withForgedeck({}, deps)
    await fn(PHASE_BUILD)
    await fn(PHASE_BUILD)
    await fn(PHASE_BUILD)
    expect(deps.compileCalls).toBe(1)
  })

  it('does not compile outside a build phase', async () => {
    const deps = makeDeps()
    const fn = withForgedeck({}, deps)
    await fn(PHASE_RUNTIME)
    expect(deps.compileCalls).toBe(0)
  })

  it('compiles again after the guard is reset (a fresh build)', async () => {
    const deps = makeDeps()
    const fn = withForgedeck({}, deps)
    await fn(PHASE_BUILD)
    __resetForgedeckGuard()
    await fn(PHASE_BUILD)
    expect(deps.compileCalls).toBe(2)
  })

  it('does not compile in a Next worker process (IS_NEXT_WORKER=true)', async () => {
    // Next's build workers re-evaluate next.config.js with the build phase in
    // FRESH processes, where the per-process guard cannot help. The worker marker
    // env (set by next/dist/lib/worker.js) is the skip signal — but the tracing
    // merge must still be applied so workers see the same config.
    const saved = process.env.IS_NEXT_WORKER
    process.env.IS_NEXT_WORKER = 'true'
    try {
      const deps = makeDeps()
      const fn = withForgedeck({}, deps)
      const cfg = await fn(PHASE_BUILD)
      expect(deps.compileCalls).toBe(0)
      expect(cfg.outputFileTracingIncludes).toEqual({
        '/api/mcp': ['./.agent/**/*', './.agent-public/**/*'],
      })
    } finally {
      if (saved === undefined) delete process.env.IS_NEXT_WORKER
      else process.env.IS_NEXT_WORKER = saved
    }
  })
})

// --- voice: format, first-build vs steady-state ---------------------------

describe('build voice', () => {
  it('prints the exact one-line voice on a steady-state build', async () => {
    const deps = makeDeps({ agentDirExists: () => true })
    await runForgedeckExtraction('/proj', deps)
    // 3 actions: 1 read enabled, 2 mutations locked; 2 entities; warnings:
    //   post_orders has an input + auth required (no warn); delete_cart is a write
    //   with no input contract -> 1 warning. The one-line leads the output.
    const firstLine = deps.logs[0].split('\n')[0]
    expect(firstLine).toBe(
      'forgedeck ✓ 3 actions (1 reads enabled, 2 mutations locked) · 2 entities · 1 warnings → .agent/',
    )
    // the single warning is echoed under the one line, then the coverage pointer
    expect(deps.logs[0]).toContain('  ! delete_cart: write action with no input contract')
    expect(deps.logs[0]).toContain('run `forgedeck coverage` for the full report')
  })

  it('echoes up to five warnings then points to forgedeck coverage', async () => {
    const many = ir({
      coverage: {
        extracted: 3,
        skipped: Array.from({ length: 8 }, (_, i) => ({
          file: `f${i}.ts`,
          reason: `reason ${i}`,
        })),
      },
    })
    const deps = makeDeps({ agentDirExists: () => true, compile: async () => many })
    await runForgedeckExtraction('/proj', deps)
    const out = deps.logs[0].split('\n')
    // one-line + 5 echoed warnings + 1 truncation pointer
    const echoed = out.filter((l) => l.startsWith('  ! '))
    expect(echoed.length).toBe(5)
    expect(out[out.length - 1]).toContain('run `forgedeck coverage`')
    expect(out[out.length - 1]).toContain('more')
  })

  it('prints the fuller teaching table on the first build (no prior .agent/)', async () => {
    const deps = makeDeps({ agentDirExists: () => false })
    await runForgedeckExtraction('/proj', deps)
    const table = deps.logs[0]
    // leads with the one-line, then the teaching sections
    expect(table.startsWith('forgedeck ✓ 3 actions')).toBe(true)
    expect(table).toContain('actions by kind: 2 route · 1 server-action · 0 pages-api')
    expect(table).toContain('locked mutations:')
    expect(table).toContain('- post_orders (write locked by default')
    expect(table).toContain('- delete_cart (irreversible locked by default')
    expect(table).toContain('auth: 2 required · 0 unknown · 1 none')
    // exactly the two next-step pointers
    expect(table).toContain('next: run `forgedeck coverage`')
    expect(table).toContain('next: enable specific mutations by name')
  })

  it('steady-state build with no warnings prints only the one line', async () => {
    const clean = ir({
      actions: [action({ name: 'get_products', effect: 'read' })],
      coverage: { extracted: 1, skipped: [] },
    })
    const deps = makeDeps({ agentDirExists: () => true, compile: async () => clean })
    await runForgedeckExtraction('/proj', deps)
    expect(deps.logs[0]).toBe(
      'forgedeck ✓ 1 actions (1 reads enabled, 0 mutations locked) · 2 entities · 0 warnings → .agent/',
    )
    expect(deps.logs[0].includes('\n')).toBe(false)
  })
})

// --- failure fallback & ConfigError rethrow -------------------------------

describe('never break the build', () => {
  it('swallows an extraction failure: loud warn, no emit, config still returned', async () => {
    const deps = makeDeps({
      agentDirExists: () => true,
      compile: async () => {
        throw new Error('ts-morph blew up')
      },
    })
    const fn = withForgedeck({ reactStrictMode: true }, deps)
    const cfg = await fn(PHASE_BUILD)
    // did not throw; config returned with tracing merge intact
    expect(cfg.reactStrictMode).toBe(true)
    expect(cfg.outputFileTracingIncludes).toEqual({
      '/api/mcp': ['./.agent/**/*', './.agent-public/**/*'],
    })
    // loud warning printed, nothing emitted (last-good .agent/ untouched)
    expect(deps.warns.join('\n')).toContain('agent extraction FAILED')
    expect(deps.warns.join('\n')).toContain('ts-morph blew up')
    expect(deps.emitCalls).toBe(0)
    expect(deps.logs.length).toBe(0)
  })

  it('rethrows a ConfigError so the build fails, with the explanation attached', async () => {
    const deps = makeDeps({
      compile: async () => {
        throw new ConfigError("unknown config key 'brdiges'")
      },
    })
    const fn = withForgedeck({}, deps)
    await expect(fn(PHASE_BUILD)).rejects.toThrowError(ConfigError)
    __resetForgedeckGuard()
    await expect(fn(PHASE_BUILD)).rejects.toThrow(ConfigError.explanation)
  })

  it('does not double-append the explanation when it is already present', async () => {
    const msg = `boom\n${ConfigError.explanation}`
    const deps = makeDeps({
      compile: async () => {
        throw new ConfigError(msg)
      },
    })
    const fn = withForgedeck({}, deps)
    await expect(fn(PHASE_BUILD)).rejects.toThrowError(
      new RegExp(`^boom\\n${escapeRe(ConfigError.explanation)}$`),
    )
  })
})

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
