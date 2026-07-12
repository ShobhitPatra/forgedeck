import { describe, it, expect, afterAll } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  readFileSync,
  existsSync,
  writeFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile } from '../src/compile'
import { emitBundle } from '../src/emit/bundle'
import { renderCoverage } from '../src/emit/coverage'
import { prunePublicIR } from '../src/emit/public'
import { runBuild, publicOutDir } from '../src/build'
import type { ActionIR, SemanticIR } from '../src/ir/types'
import type { ToolsManifest } from '../src/emit/tools'

// --- synthetic IR builder (mirrors plugin.test's shape) -------------------

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

function ir(actions: ActionIR[], over: Partial<SemanticIR> = {}): SemanticIR {
  return {
    app: { name: 'shop', framework: 'nextjs-app-router' },
    entities: [],
    actions,
    workflows: [],
    coverage: { extracted: actions.length, skipped: [] },
    ...over,
  }
}

// The canonical mix the pruning rule must sort correctly.
function mixedActions(): ActionIR[] {
  return [
    // provably-public read — the ONLY auto-qualifier
    action({ name: 'read_none', effect: 'read', auth: 'none' }),
    // read, but auth UNKNOWN — not provable, EXCLUDED
    action({ name: 'read_unknown', effect: 'read', auth: 'unknown' }),
    // read, auth REQUIRED — EXCLUDED
    action({ name: 'read_required', effect: 'read', auth: 'required' }),
    // an enabled mutation (config-allowlisted) — NOT public unless explicitly named
    action({
      name: 'write_enabled',
      effect: 'write',
      auth: 'none',
      enabled: true,
      enabledBy: 'config-allowlist',
    }),
    // a locked mutation
    action({
      name: 'write_locked',
      effect: 'write',
      auth: 'unknown',
      enabled: false,
      enabledBy: undefined,
    }),
  ]
}

describe('prunePublicIR — the D2 auto-curation rule', () => {
  it('public:true keeps ONLY provably-public reads (auth none + read); unknown-auth reads excluded', () => {
    const r = prunePublicIR(ir(mixedActions()), true)
    expect(r.ir.actions.map((a) => a.name)).toEqual(['read_none'])
    expect(r.count).toBe(1)
    expect(r.namedMutations).toEqual([])
    // the enabled mutation is NOT public just because it is enabled internally
    expect(r.ir.actions.some((a) => a.name === 'write_enabled')).toBe(false)
  })

  it('annotation-derived auth:none read qualifies exactly like a derived one', () => {
    const annotated = action({
      name: 'get_health',
      effect: 'read',
      auth: 'none',
      evidence: ['@agent auth none'],
    })
    const r = prunePublicIR(ir([annotated]), true)
    expect(r.ir.actions.map((a) => a.name)).toEqual(['get_health'])
  })

  it('explicitly named actions are included at ANY effect, and named non-reads are flagged loudly', () => {
    const r = prunePublicIR(ir(mixedActions()), { actions: ['write_enabled', 'write_locked'] })
    // both named writes come in, plus the auto-qualifying read
    expect(new Set(r.ir.actions.map((a) => a.name))).toEqual(
      new Set(['read_none', 'write_enabled', 'write_locked']),
    )
    // every named non-read is surfaced as a deliberate public mutation
    expect(new Set(r.namedMutations)).toEqual(new Set(['write_enabled', 'write_locked']))
  })

  it('a named read is included but NOT counted as a mutation', () => {
    const r = prunePublicIR(ir(mixedActions()), { actions: ['read_unknown'] })
    expect(r.ir.actions.map((a) => a.name).sort()).toEqual(['read_none', 'read_unknown'])
    expect(r.namedMutations).toEqual([])
  })

  it('reports names that matched no extracted action (likely a typo)', () => {
    const r = prunePublicIR(ir(mixedActions()), { actions: ['nope', 'read_none'] })
    expect(r.unmatchedNamed).toEqual(['nope'])
  })

  it('prunes entities to those the surviving actions touch, and leaks no internal-only entity', () => {
    const actions = [
      action({ name: 'read_none', effect: 'read', auth: 'none', entitiesTouched: ['Product'] }),
      action({
        name: 'read_secret',
        effect: 'read',
        auth: 'required',
        entitiesTouched: ['Ledger'],
      }),
    ]
    const full = ir(actions, {
      entities: [
        { name: 'Product', fields: [], relations: [], sourceFile: 's' },
        { name: 'Ledger', fields: [], relations: [], sourceFile: 's' },
      ],
    })
    const r = prunePublicIR(full, true)
    expect(r.ir.entities.map((e) => e.name)).toEqual(['Product'])
  })

  it('drops workflows that reference any non-public action', () => {
    const actions = [
      action({ name: 'read_none', effect: 'read', auth: 'none' }),
      action({ name: 'read_secret', effect: 'read', auth: 'required' }),
    ]
    const full = ir(actions, {
      workflows: [
        { name: 'public_only', steps: [{ step: 1, action: 'read_none' }] },
        { name: 'leaky', steps: [{ step: 1, action: 'read_secret' }] },
      ],
    })
    const r = prunePublicIR(full, true)
    expect(r.ir.workflows.map((w) => w.name)).toEqual(['public_only'])
  })
})

// --- runBuild: two artifacts, coverage, separation ------------------------

/** A throwaway project with a forgedeck.config.ts. Returns the project dir. */
function project(configSource: string | null, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'fd-store-'))
  // A minimal app so compile() finds an app-router project + one public read.
  const base: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'store-shop' }),
    'app/api/health/route.ts':
      '/**\n * @agent auth none\n */\nexport async function GET() { return Response.json({ ok: true }) }\n',
    'app/api/orders/route.ts':
      'export async function POST(req: Request) { return Response.json({ id: 1 }) }\n',
    ...files,
  }
  for (const [rel, content] of Object.entries(base)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  if (configSource !== null) writeFileSync(join(dir, 'forgedeck.config.ts'), configSource)
  return dir
}

const cleanups: string[] = []
function tracked(dir: string): string {
  cleanups.push(dir)
  return dir
}

afterAll(() => {
  for (const d of cleanups.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('runBuild — public storefront artifact', () => {
  it('emits a SEPARATE .agent-public bundle only when public is set', async () => {
    const dir = tracked(project(`export default { public: true }`))
    const outDir = join(dir, '.agent')
    const res = await runBuild(dir, outDir)
    expect(res.public).toBeDefined()
    expect(existsSync(join(publicOutDir(outDir), 'tools.json'))).toBe(true)
    // internal bundle still there
    expect(existsSync(join(outDir, 'tools.json'))).toBe(true)
  })

  it('does NOT emit .agent-public when public is unset', async () => {
    const dir = tracked(project(`export default {}`))
    const outDir = join(dir, '.agent')
    const res = await runBuild(dir, outDir)
    expect(res.public).toBeUndefined()
    expect(existsSync(publicOutDir(outDir))).toBe(false)
  })

  it('retires a STALE public bundle when public is later turned off', async () => {
    const dir = tracked(project(`export default { public: true }`))
    const outDir = join(dir, '.agent')
    await runBuild(dir, outDir)
    expect(existsSync(join(publicOutDir(outDir), 'tools.json'))).toBe(true)
    // turn the storefront off and rebuild
    writeFileSync(join(dir, 'forgedeck.config.ts'), `export default {}`)
    await runBuild(dir, outDir)
    expect(existsSync(publicOutDir(outDir))).toBe(false)
  })

  it('internal bundle is BYTE-IDENTICAL whether or not public is enabled (except coverage.txt)', async () => {
    const withPublic = tracked(project(`export default { public: true }`))
    const noPublic = tracked(project(`export default {}`))
    const a = join(withPublic, '.agent')
    const b = join(noPublic, '.agent')
    await runBuild(withPublic, a)
    await runBuild(noPublic, b)
    // Compare every emitted file EXCEPT coverage.txt (which legitimately gains PUBLIC lines).
    const rels = [
      'index.md',
      'tools.json',
      'ir.json',
      'actions/get_health.md',
      'actions/post_orders.md',
    ]
    for (const rel of rels) {
      expect(readFileSync(join(a, rel), 'utf8')).toBe(readFileSync(join(b, rel), 'utf8'))
    }
  })

  it("coverage gains a 'PUBLIC: N actions' line naming the public surface", async () => {
    const dir = tracked(project(`export default { public: true }`))
    const outDir = join(dir, '.agent')
    const res = await runBuild(dir, outDir)
    expect(res.report).toContain('PUBLIC: 1 actions')
    // the public bundle carries its OWN coverage
    expect(existsSync(join(publicOutDir(outDir), 'coverage.txt'))).toBe(true)
  })

  it('logs named mutations LOUDLY in coverage', async () => {
    const dir = tracked(project(`export default { public: { actions: ['post_orders'] } }`))
    const outDir = join(dir, '.agent')
    const res = await runBuild(dir, outDir)
    expect(res.report).toContain('PUBLIC MUTATION by explicit config: post_orders')
    expect(res.report).toContain('PUBLIC: 2 actions')
  })

  it('public:true with ZERO qualifying actions still emits an empty bundle + a warning', async () => {
    // an app with no auth:none read
    const dir = tracked(
      project(`export default { public: true }`, {
        'app/api/health/route.ts':
          'export async function GET() { return Response.json({ ok: true }) }\n',
      }),
    )
    const outDir = join(dir, '.agent')
    const res = await runBuild(dir, outDir)
    expect(res.public!.count).toBe(0)
    expect(res.report).toContain('public storefront enabled but no actions qualify')
    // still a real (empty-tools) bundle
    const manifest: ToolsManifest = JSON.parse(
      readFileSync(join(publicOutDir(outDir), 'tools.json'), 'utf8'),
    )
    expect(manifest.tools).toEqual([])
  })
})

// --- integration: real hybrid-shop extraction -----------------------------

describe('integration — hybrid-shop public storefront', () => {
  it('public tools.json contains get_health and NONE of the unknown-auth reads or writes', async () => {
    const src = 'tests/fixtures/hybrid-shop'
    const dir = tracked(mkdtempSync(join(tmpdir(), 'fd-hybrid-')))
    cpSync(src, dir, { recursive: true })
    // enable the storefront on the copy (leave the committed fixture untouched)
    writeFileSync(
      join(dir, 'forgedeck.config.ts'),
      `import { defineConfig } from 'forgedeck'\nexport default defineConfig({ public: true })\n`,
    )
    const outDir = join(dir, '.agent')
    const res = await runBuild(dir, outDir)

    const pub: ToolsManifest = JSON.parse(
      readFileSync(join(publicOutDir(outDir), 'tools.json'), 'utf8'),
    )
    const names = pub.tools.map((t) => t.name)
    // get_health: @agent auth none, GET (read) — the ONE qualifier
    expect(names).toContain('get_health')
    expect(res.public!.count).toBe(1)
    // unknown-auth reads that are enabled internally must NOT be public
    for (const leaked of ['get_stats', 'get_surveys', 'get_exports', 'get_documents']) {
      expect(names).not.toContain(leaked)
    }
    // no writes / mutations leak
    for (const w of ['post_documents', 'delete_survey', 'post_billing', 'put_settings']) {
      expect(names).not.toContain(w)
    }
    // every surviving tool is a read with auth none, by construction
    for (const t of pub.tools) {
      expect(t.effect).toBe('read')
      expect(t.auth).toBe('none')
    }
  })

  it('the INTERNAL bundle still exposes the full enabled surface (two artifacts)', async () => {
    const ir0 = await compile('tests/fixtures/hybrid-shop')
    const out = tracked(mkdtempSync(join(tmpdir(), 'fd-hybrid-int-')))
    emitBundle(ir0, out)
    const internal: ToolsManifest = JSON.parse(readFileSync(join(out, 'tools.json'), 'utf8'))
    // the internal manifest carries the unknown-auth reads the public one prunes
    expect(internal.tools.map((t) => t.name)).toContain('get_stats')
    // and prune leaves it intact
    const pruned = prunePublicIR(ir0, true)
    expect(pruned.ir.actions.map((a) => a.name)).toEqual(['get_health'])
    expect(renderCoverage(pruned.ir)).toContain('1 actions extracted')
  })
})
