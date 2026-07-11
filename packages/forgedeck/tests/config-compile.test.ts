import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile, globToRegExp, applyAllowlist } from '../src/compile'
import type { ActionIR, SemanticIR } from '../src/ir/types'

// Resolution reads FORGEDECK_ENV -> NODE_ENV -> base; vitest sets NODE_ENV=test, so
// clear both for a deterministic `base` environment across this file.
const savedEnv = { FORGEDECK_ENV: process.env.FORGEDECK_ENV, NODE_ENV: process.env.NODE_ENV }
beforeAll(() => {
  delete process.env.FORGEDECK_ENV
  delete process.env.NODE_ENV
})
afterAll(() => {
  process.env.FORGEDECK_ENV = savedEnv.FORGEDECK_ENV
  process.env.NODE_ENV = savedEnv.NODE_ENV
})

// A throwaway app-router project with two GET routes and one POST route, plus an
// optional forgedeck.config.ts, so config wiring is exercised end-to-end through
// compile without touching the frozen fixtures.
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function makeProject(config?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'fd-cc-'))
  dirs.push(dir)
  const write = (rel: string, src: string) => {
    const p = join(dir, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, src)
  }
  write('package.json', JSON.stringify({ name: 'temp-shop' }))
  write('app/api/gadgets/route.ts', `export async function GET() { return Response.json([]) }`)
  write('app/api/widgets/route.ts', `export async function GET() { return Response.json([]) }`)
  write(
    'app/api/orders/route.ts',
    `export async function POST(req: Request) {
       const body = await req.json()
       return Response.json({ ok: true, body })
     }`,
  )
  if (config !== undefined) write('forgedeck.config.ts', config)
  return dir
}

function mkAction(name: string, effect: ActionIR['effect']): ActionIR {
  return {
    name,
    kind: 'route',
    method: effect === 'read' ? 'GET' : 'POST',
    path: `/api/${name}`,
    sourceFile: `app/api/${name}/route.ts`,
    exportName: effect === 'read' ? 'GET' : 'POST',
    description: name,
    inputs: [],
    effect,
    entitiesTouched: [],
    enabled: effect === 'read',
    enabledBy: effect === 'read' ? 'read-default' : undefined,
    confidence: 'static',
    auth: 'unknown',
    preconditions: [],
    evidence: [],
  }
}

describe('globToRegExp', () => {
  it('matches * within a single segment only', () => {
    expect(globToRegExp('app/*/route.ts').test('app/api/route.ts')).toBe(true)
    expect(globToRegExp('app/*/route.ts').test('app/a/b/route.ts')).toBe(false)
  })
  it('matches ** across segments', () => {
    expect(globToRegExp('ee/**').test('ee/a/b/c.ts')).toBe(true)
    expect(globToRegExp('**/secret.ts').test('a/b/secret.ts')).toBe(true)
  })
  it('escapes regex metacharacters in literals', () => {
    expect(globToRegExp('a.b/c.ts').test('axb/c.ts')).toBe(false)
    expect(globToRegExp('a.b/c.ts').test('a.b/c.ts')).toBe(true)
  })
})

describe('applyAllowlist', () => {
  it('enables a non-read allowlisted action with a config-allowlist receipt', () => {
    const actions = [mkAction('post_orders', 'write')]
    const skips = applyAllowlist(actions, ['post_orders'], 'base')
    expect(actions[0]).toMatchObject({ enabled: true, enabledBy: 'config-allowlist' })
    expect(actions[0].evidence).toContain('enabled via config allowlist (base)')
    expect(skips).toEqual([])
  })
  it('leaves reads untouched (already enabled by default)', () => {
    const actions = [mkAction('get_gadgets', 'read')]
    applyAllowlist(actions, ['get_gadgets'], 'base')
    expect(actions[0].enabledBy).toBe('read-default')
    expect(actions[0].evidence).toEqual([])
  })
  it('skip-logs an unknown allowlisted name with a near-match suggestion', () => {
    const actions = [mkAction('post_orders', 'write')]
    const skips = applyAllowlist(actions, ['post_order'], 'base')
    expect(actions[0].enabled).toBe(false)
    expect(skips).toEqual([
      {
        file: 'forgedeck.config.ts',
        reason: "post_order in allowlist but not found — did you mean 'post_orders'?",
      },
    ])
  })
})

describe('compile applies the config allowlist', () => {
  let ir: SemanticIR
  beforeAll(async () => {
    ir = await compile(makeProject(`export default { enabledActions: ['post_orders'] }`))
  })
  it('enables exactly the allowlisted mutation with evidence and enabledBy', () => {
    const post = ir.actions.find((a) => a.name === 'post_orders')!
    expect(post).toMatchObject({ enabled: true, enabledBy: 'config-allowlist' })
    expect(post.evidence).toContain('enabled via config allowlist (base)')
  })
  it('leaves every other action at its default enabled state', () => {
    expect(ir.actions.filter((a) => a.effect !== 'read' && a.enabled).map((a) => a.name)).toEqual([
      'post_orders',
    ])
  })
  it('prints the resolved-environment line in coverage', () => {
    expect(ir.coverage.environment).toBe('environment: base (via default)')
  })
})

describe('compile applies exclude globs before extraction', () => {
  it('drops matched files and skip-logs them, extracting no surface from them', async () => {
    const ir = await compile(makeProject(`export default { exclude: ['app/api/widgets/**'] }`))
    expect(ir.actions.map((a) => a.name).sort()).toEqual(['get_gadgets', 'post_orders'])
    expect(ir.coverage.skipped).toContainEqual({
      file: 'app/api/widgets/route.ts',
      reason: 'excluded by config',
    })
  })
})

describe('hybrid-shop fixture config enables exactly post_documents', () => {
  let hybrid: SemanticIR
  let mini: SemanticIR
  beforeAll(async () => {
    hybrid = await compile('tests/fixtures/hybrid-shop')
    mini = await compile('tests/fixtures/mini-shop')
  })
  it('enables post_documents via the committed config with a receipt', () => {
    const post = hybrid.actions.find((a) => a.name === 'post_documents')!
    expect(post).toMatchObject({ enabled: true, enabledBy: 'config-allowlist' })
    expect(post.evidence).toContain('enabled via config allowlist (base)')
  })
  it('leaves every other mutation disabled', () => {
    expect(
      hybrid.actions.filter((a) => a.effect !== 'read' && a.enabled).map((a) => a.name),
    ).toEqual(['post_documents'])
  })
  it('mini-shop has no config: reads stay read-default, no config-allowlist, no env line', () => {
    expect(mini.coverage.environment).toBeUndefined()
    expect(mini.coverage.skipped).toEqual([])
    expect([
      ...new Set(mini.actions.filter((a) => a.effect === 'read').map((a) => a.enabledBy)),
    ]).toEqual(['read-default'])
    expect(mini.actions.some((a) => a.enabledBy === 'config-allowlist')).toBe(false)
  })
})

describe('compile lists unapplied environment blocks', () => {
  it('notes present-but-dormant environment blocks in coverage', async () => {
    const ir = await compile(
      makeProject(
        `export default { environments: { staging: { enabledActions: ['post_orders'] } } }`,
      ),
    )
    // No FORGEDECK_ENV -> base is active, staging is present but dormant.
    expect(ir.coverage.skipped).toContainEqual({
      file: 'forgedeck.config.ts',
      reason: 'environment block staging present, not active',
    })
    // The dormant block did not enable the mutation.
    expect(ir.actions.find((a) => a.name === 'post_orders')!.enabled).toBe(false)
  })
})
