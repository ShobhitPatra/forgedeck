import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile } from '../src/compile'
import { loadConfig } from '../src/config/load'
import {
  bridgeImportPath,
  bridgeShim,
  generateBridges,
  type GenerateBridgesOptions,
} from '../src/emit/bridges'
import { loadMiddlewareMatchers } from '../src/extract/auth'
import { ConfigError } from '../src/config/schema'
import type { ActionIR, SemanticIR } from '../src/ir/types'
import { fakeLoaded } from './helpers'

// Env resolution reads OPDECK_ENV -> NODE_ENV -> base; vitest sets NODE_ENV=test.
// Clear both so the committed hybrid-shop config resolves to its base allowlist.
const savedEnv = { OPDECK_ENV: process.env.OPDECK_ENV, NODE_ENV: process.env.NODE_ENV }
beforeAll(() => {
  delete process.env.OPDECK_ENV
  delete process.env.NODE_ENV
})
afterAll(() => {
  process.env.OPDECK_ENV = savedEnv.OPDECK_ENV
  process.env.NODE_ENV = savedEnv.NODE_ENV
})

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function tmpCopy(fixture: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'fd-bridge-'))
  dirs.push(dir)
  cpSync(fixture, dir, { recursive: true })
  return dir
}
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fd-bridge-'))
  dirs.push(dir)
  return dir
}

// A minimal server-action IR node, enabled via the config allowlist (the bridge set).
function serverAction(over: Partial<ActionIR> = {}): ActionIR {
  return {
    name: 'delete_survey',
    kind: 'server-action',
    sourceFile: 'app/actions/surveys.ts',
    exportName: 'deleteSurvey',
    description: 'server action deleteSurvey',
    inputs: [],
    effect: 'irreversible',
    entitiesTouched: ['Document'],
    enabled: true,
    enabledBy: 'config-allowlist',
    confidence: 'static',
    auth: 'required',
    preconditions: [],
    evidence: [],
    ...over,
  }
}
function irOf(...actions: ActionIR[]): SemanticIR {
  return {
    app: { name: 'fake', framework: 'nextjs-app-router' },
    entities: [],
    actions,
    workflows: [],
    coverage: { extracted: actions.length, skipped: [] },
  }
}
const opts = (o: Partial<GenerateBridgesOptions> = {}): GenerateBridgesOptions => ({
  write: true,
  ...o,
})

describe('bridgeShim / bridgeImportPath (pure)', () => {
  it('computes the relative import from the shim dir to the source (app/actions)', () => {
    // shim at app/api/.agent/delete_survey/route.ts -> action at app/actions/surveys.ts
    expect(bridgeImportPath('app/api/.agent/delete_survey', 'app/actions/surveys.ts')).toBe(
      '../../../actions/surveys',
    )
  })
  it('computes the relative import for a deeply nested source file', () => {
    expect(
      bridgeImportPath('app/api/.agent/do_thing', 'app/features/surveys/server/actions.ts'),
    ).toBe('../../../features/surveys/server/actions')
  })
  it('handles a src/app tree', () => {
    expect(bridgeImportPath('src/app/api/.agent/delete_survey', 'src/lib/actions.ts')).toBe(
      '../../../../lib/actions',
    )
  })
  it('renders the exact shim bytes', () => {
    expect(bridgeShim('deleteSurvey', '../../../actions/surveys')).toBe(
      `import { createBridgeHandler } from 'opdeck/bridge'\n` +
        `import { deleteSurvey } from '../../../actions/surveys'\n` +
        `export const POST = createBridgeHandler(deleteSurvey)\n`,
    )
  })
})

describe('generateBridges write gate', () => {
  it('does nothing on disk when write is false', () => {
    const dir = freshDir()
    const res = generateBridges(irOf(serverAction()), undefined, dir, opts({ write: false }))
    expect(res).toEqual({ coverage: [], generated: [], removed: [] })
    expect(existsSync(join(dir, 'app/api/.agent'))).toBe(false)
  })
})

describe('generateBridges existence mirrors the allowlist (kind gating)', () => {
  it('bridges ONLY allowlisted server actions — routes and pages-api never get one', () => {
    const dir = freshDir()
    const route: ActionIR = serverAction({
      name: 'post_orders',
      kind: 'route',
      exportName: 'POST',
      sourceFile: 'app/api/orders/route.ts',
    })
    const pages: ActionIR = serverAction({
      name: 'post_documents',
      kind: 'pages-api',
      exportName: 'default',
      sourceFile: 'pages/api/documents.ts',
    })
    const res = generateBridges(irOf(route, pages, serverAction()), undefined, dir, opts())
    expect(res.generated).toEqual(['delete_survey'])
    expect(existsSync(join(dir, 'app/api/.agent/delete_survey/route.ts'))).toBe(true)
    expect(existsSync(join(dir, 'app/api/.agent/post_orders'))).toBe(false)
    expect(existsSync(join(dir, 'app/api/.agent/post_documents'))).toBe(false)
  })

  it('does not bridge a read-default (non-allowlist) server action', () => {
    const dir = freshDir()
    const read = serverAction({ name: 'get_survey', effect: 'read', enabledBy: 'read-default' })
    const res = generateBridges(irOf(read), undefined, dir, opts())
    expect(res.generated).toEqual([])
    expect(existsSync(join(dir, 'app/api/.agent'))).toBe(false)
  })
})

describe('generateBridges add/remove cycle on a tmp hybrid-shop copy', () => {
  it('generates delete_survey with exact shim bytes, then removes it when de-allowlisted', async () => {
    const dir = tmpCopy('tests/fixtures/hybrid-shop')
    const ir = await compile(dir)
    const config = await loadConfig(dir)

    const add = generateBridges(ir, config, dir, opts())
    expect(add.generated).toContain('delete_survey')
    expect(add.coverage).toContainEqual({
      file: 'app/api/.agent/delete_survey/route.ts',
      reason: 'bridge generated: delete_survey',
    })
    const shim = join(dir, 'app/api/.agent/delete_survey/route.ts')
    expect(readFileSync(shim, 'utf8')).toBe(
      `import { createBridgeHandler } from 'opdeck/bridge'\n` +
        `import { deleteSurvey } from '../../../actions/surveys'\n` +
        `export const POST = createBridgeHandler(deleteSurvey)\n`,
    )

    // De-allowlist delete_survey (config authority removed) and rebuild: lock 1 says
    // the shim must disappear — existence mirrors the allowlist exactly.
    const del = ir.actions.find((a) => a.name === 'delete_survey')!
    del.enabled = false
    del.enabledBy = undefined
    const remove = generateBridges(ir, config, dir, opts())
    expect(remove.removed).toContain('delete_survey')
    expect(remove.coverage).toContainEqual({
      file: 'app/api/.agent/delete_survey/route.ts',
      reason: 'bridge removed: delete_survey',
    })
    expect(existsSync(shim)).toBe(false)
  })

  it('re-extracting a project with generated shims does not pollute the IR', async () => {
    const dir = tmpCopy('tests/fixtures/hybrid-shop')
    const ir = await compile(dir)
    const config = await loadConfig(dir)
    generateBridges(ir, config, dir, opts())
    // Recompile the same tree, now containing app/api/.agent/*/route.ts shims.
    const again = await compile(dir)
    expect(again.actions.some((a) => a.sourceFile.includes('.agent'))).toBe(false)
    expect(again.coverage.skipped.some((s) => s.reason.includes('createBridgeHandler'))).toBe(false)
  })
})

describe('generateBridges lock 4: middleware coverage', () => {
  // Build real matchers the fakeLoaded way — a middleware file whose matcher does not
  // cover /api/.agent/*.
  const uncovered = loadMiddlewareMatchers(
    fakeLoaded({ 'middleware.ts': `export const config = { matcher: ['/api/reports/:path*'] }` }),
  )
  const covered = loadMiddlewareMatchers(
    fakeLoaded({ 'middleware.ts': `export const config = { matcher: ['/api/:path*'] }` }),
  )
  // A server action whose auth was established by a middleware matcher (rare, but the
  // check still runs for every bridged action).
  const midAuth = serverAction({
    evidence: ['auth required via middleware matcher /api/reports/:path*'],
  })

  it('throws a ConfigError with the exact fix text when no matcher covers /api/.agent/*', () => {
    const dir = freshDir()
    let err: unknown
    try {
      generateBridges(irOf(midAuth), undefined, dir, opts({ matchers: uncovered }))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ConfigError)
    expect((err as Error).message).toContain(
      'extend the matcher to cover /api/.agent/* or rely on in-action checks',
    )
    // No half-written shim tree left behind.
    expect(existsSync(join(dir, 'app/api/.agent'))).toBe(false)
  })

  it('generates without error when a matcher covers /api/.agent/*', () => {
    const dir = freshDir()
    const res = generateBridges(irOf(midAuth), undefined, dir, opts({ matchers: covered }))
    expect(res.generated).toEqual(['delete_survey'])
  })

  it('does not fire when the action auth did not come from a middleware matcher', () => {
    const dir = freshDir()
    // Wrapper-derived auth, uncovered matchers — no error, because the auth evidence
    // is not middleware-derived.
    const res = generateBridges(irOf(serverAction()), undefined, dir, opts({ matchers: uncovered }))
    expect(res.generated).toEqual(['delete_survey'])
  })
})

describe('committed hybrid-shop fixture stays pristine', () => {
  it('has no generated app/api/.agent directory checked in', () => {
    expect(existsSync('tests/fixtures/hybrid-shop/app/api/.agent')).toBe(false)
  })
})
