import { describe, it, expect } from 'vitest'
import { loadProject } from '../src/load/project'
import { extractRoutes } from '../src/extract/routes'
import { fakeLoaded } from './helpers'

describe('extractRoutes', () => {
  const { actions, skipped } = extractRoutes(loadProject('tests/fixtures/mini-shop'))

  it('extracts all three route handlers', () => {
    expect(actions.map((a) => a.name).sort()).toEqual([
      'get_products',
      'get_products_by_id',
      'post_orders',
    ])
    expect(skipped).toEqual([])
  })
  it('marks reads enabled and writes disabled', () => {
    const list = actions.find((a) => a.name === 'get_products')!
    expect(list).toMatchObject({
      effect: 'read',
      enabled: true,
      entitiesTouched: ['Product'],
      method: 'GET',
      path: '/api/products',
    })
    const create = actions.find((a) => a.name === 'post_orders')!
    expect(create).toMatchObject({ effect: 'write', enabled: false, entitiesTouched: ['Order'] })
  })
  it('extracts input contract for the write route', () => {
    const create = actions.find((a) => a.name === 'post_orders')!
    expect(create.inputs).toEqual([
      { name: 'email', type: 'string', required: true, location: 'body' },
      { name: 'productId', type: 'string', required: true, location: 'body' },
      { name: 'quantity', type: 'number', required: true, location: 'body' },
    ])
  })
})

describe('extractRoutes arrow handlers', () => {
  it('extracts exported const arrow handlers', () => {
    const { actions } = extractRoutes(
      fakeLoaded({
        '/app/api/health/route.ts': `export const GET = async () => new Response('ok')`,
      }),
    )
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      name: 'get_health',
      method: 'GET',
      effect: 'read',
      enabled: true,
    })
  })
})

describe('extractRoutes wrapped handlers', () => {
  it('unwraps an object-literal handler wrapper and keeps auth unknown for a neutral wrapper', () => {
    const { actions, skipped } = extractRoutes(
      fakeLoaded({
        '/lib/db.ts': `export const prisma = {} as any`,
        '/app/api/surveys/route.ts': `import { prisma } from '../../../lib/db'
export const GET = withV1Wrapper({
  handler: async () => Response.json(await prisma.document.findMany()),
})`,
      }),
    )
    expect(skipped).toEqual([])
    const survey = actions.find((a) => a.name === 'get_surveys')!
    expect(survey).toMatchObject({
      method: 'GET',
      effect: 'read',
      enabled: true,
      entitiesTouched: ['Document'],
      auth: 'unknown',
    })
    expect(survey.evidence).toContain('handler via wrapper withV1Wrapper')
  })

  it('unwraps an identifier handler wrapper resolved locally', () => {
    const { actions } = extractRoutes(
      fakeLoaded({
        '/app/api/reports/route.ts': `const impl = async () => new Response('ok')
export const GET = withCache(impl)`,
      }),
    )
    const report = actions.find((a) => a.name === 'get_reports')!
    expect(report).toMatchObject({ method: 'GET', effect: 'read', enabled: true })
    expect(report.evidence).toContain('handler via wrapper withCache')
  })

  it('reads auth from an auth-shaped wrapper name', () => {
    const { actions } = extractRoutes(
      fakeLoaded({
        '/app/api/admin/route.ts': `export const GET = withAuth(async () => new Response('ok'))`,
      }),
    )
    expect(actions.find((a) => a.name === 'get_admin')!.auth).toBe('required')
  })

  it('skip-logs a wrapper whose handler cannot be resolved', () => {
    const { actions, skipped } = extractRoutes(
      fakeLoaded({
        '/app/api/opaque/route.ts': `export const GET = withMystery(someUnknownRef)`,
      }),
    )
    expect(actions.find((a) => a.name === 'get_opaque')).toBeFalsy()
    expect(skipped).toContainEqual({
      file: 'app/api/opaque/route.ts',
      reason: 'wrapped route handler not resolved: withMystery',
    })
  })
})

describe('extractRoutes hybrid-shop wrapped route integration', () => {
  it('extracts get_surveys through the withV1Wrapper wrapper', () => {
    const { actions } = extractRoutes(loadProject('tests/fixtures/hybrid-shop'))
    const survey = actions.find((a) => a.name === 'get_surveys')!
    expect(survey).toMatchObject({
      kind: 'route',
      method: 'GET',
      effect: 'read',
      enabled: true,
      entitiesTouched: ['Document'],
      auth: 'unknown',
    })
    expect(survey.evidence).toContain('handler via wrapper withV1Wrapper')
  })
  it('classifies get_stats through the wrapped prisma.client accessor with no unresolved evidence', () => {
    const { actions } = extractRoutes(loadProject('tests/fixtures/hybrid-shop'))
    const stats = actions.find((a) => a.name === 'get_stats')!
    expect(stats).toMatchObject({
      kind: 'route',
      method: 'GET',
      effect: 'read',
      entitiesTouched: ['Document'],
    })
    expect(stats.evidence.join(' ')).toContain('prisma.client.document.findMany')
    expect(stats.evidence.join(' ')).not.toContain('unresolved')
  })
})

describe('extractRoutes barrel re-exports', () => {
  it('resolves an alias-path barrel re-export to the target handler', () => {
    const { actions, skipped } = extractRoutes(
      fakeLoaded(
        {
          '/modules/reportHandlers.ts': `export const GET = async () => Response.json(await prisma.document.findMany())`,
          '/app/api/exports/route.ts': `export { GET } from '@/modules/reportHandlers'`,
        },
        undefined,
        { baseUrl: '/', paths: { '@/*': ['./*'] } },
      ),
    )
    expect(skipped).toEqual([])
    const exp = actions.find((a) => a.name === 'get_exports')!
    expect(exp).toMatchObject({ method: 'GET', effect: 'read', enabled: true })
    expect(exp.evidence).toContain('handler via re export from modules/reportHandlers.ts')
  })

  it('resolves a relative barrel re-export with a renamed non-method alias ignored', () => {
    const { actions, skipped } = extractRoutes(
      fakeLoaded({
        '/modules/reportHandlers.ts': `export async function POST() { return Response.json(await prisma.document.create({ data: {} }), { status: 201 }) }
export const GET = async () => Response.json(await prisma.document.findMany())`,
        '/app/api/imports/route.ts': `export { POST, GET as HEAD } from '../../../modules/reportHandlers'`,
      }),
    )
    expect(skipped).toEqual([])
    const post = actions.find((a) => a.name === 'post_imports')!
    expect(post).toMatchObject({ method: 'POST', effect: 'write', enabled: false })
    expect(post.evidence).toContain('handler via re export from modules/reportHandlers.ts')
    // GET as HEAD: HEAD is not a recognized method, so nothing extra extracted
    expect(actions.filter((a) => a.name.startsWith('get_imports') || a.method === 'HEAD')).toEqual(
      [],
    )
  })

  it('skip-logs a wildcard re-export instead of following it', () => {
    const { actions, skipped } = extractRoutes(
      fakeLoaded({
        '/modules/reportHandlers.ts': `export const GET = async () => new Response('ok')`,
        '/app/api/wild/route.ts': `export * from '../../../modules/reportHandlers'`,
      }),
    )
    expect(actions.find((a) => a.name === 'get_wild')).toBeFalsy()
    expect(skipped).toContainEqual({
      file: 'app/api/wild/route.ts',
      reason: 'wildcard re export not followed',
    })
  })

  it('skip-logs an unresolvable barrel specifier', () => {
    const { actions, skipped } = extractRoutes(
      fakeLoaded({
        '/app/api/missing/route.ts': `export { GET } from './does-not-exist'`,
      }),
    )
    expect(actions.find((a) => a.name === 'get_missing')).toBeFalsy()
    expect(skipped).toContainEqual({
      file: 'app/api/missing/route.ts',
      reason: 're exported handler not resolved: ./does-not-exist',
    })
  })
})

describe('extractRoutes hybrid-shop barrel re-export integration', () => {
  const { actions, skipped } = extractRoutes(loadProject('tests/fixtures/hybrid-shop'))

  it('extracts get_exports through a relative barrel re-export', () => {
    const exp = actions.find((a) => a.name === 'get_exports')!
    expect(exp).toMatchObject({
      kind: 'route',
      method: 'GET',
      effect: 'read',
      enabled: true,
      entitiesTouched: ['Document'],
    })
    expect(exp.evidence).toContain('handler via re export from modules/reportHandlers.ts')
  })

  it('extracts post_imports through an alias barrel re-export and ignores the HEAD alias', () => {
    const post = actions.find((a) => a.name === 'post_imports')!
    expect(post).toMatchObject({
      kind: 'route',
      method: 'POST',
      effect: 'write',
      enabled: false,
      entitiesTouched: ['Document'],
    })
    expect(post.evidence).toContain('handler via re export from modules/reportHandlers.ts')
    expect(actions.some((a) => a.method === 'HEAD')).toBe(false)
  })

  it('drops the old no-http-method skip-logs for both barrels', () => {
    expect(skipped).not.toContainEqual({
      file: 'app/api/exports/route.ts',
      reason: 'no http method exports found',
    })
    expect(skipped).not.toContainEqual({
      file: 'app/api/imports/route.ts',
      reason: 'no http method exports found',
    })
  })
})

describe('extractRoutes path params', () => {
  it('adds path params as required path inputs', () => {
    const { actions } = extractRoutes(
      fakeLoaded({
        '/app/api/reports/[reportId]/route.ts': `export async function GET() { return new Response('') }`,
      }),
    )
    expect(actions[0].name).toBe('get_reports_by_report_id')
    expect(actions[0].inputs).toContainEqual({
      name: 'reportId',
      type: 'string',
      required: true,
      location: 'path',
    })
  })
})

describe('extractRoutes — auth-plumbing exclusion is annotation-aware', () => {
  const plumbingFile = '/app/api/auth/[...nextauth]/route.ts'

  it('still excludes an un-annotated catch-all auth route', () => {
    const { actions, skipped } = extractRoutes(
      fakeLoaded({ [plumbingFile]: `export function GET() { return Response.json(null) }` }),
    )
    expect(actions).toEqual([])
    expect(skipped).toContainEqual({
      file: 'app/api/auth/[...nextauth]/route.ts',
      reason: 'auth plumbing route, excluded',
    })
  })

  it('extracts an annotated catch-all auth route with override evidence', () => {
    const { actions, skipped } = extractRoutes(
      fakeLoaded({
        [plumbingFile]: `
          /**
           * @agent description begin the oauth handshake
           */
          export function GET() { return Response.json(null) }
        `,
      }),
    )
    expect(actions.length).toBe(1)
    expect(actions[0].evidence).toContain('auth plumbing exclusion overridden by annotations')
    expect(actions[0].description).toBe('begin the oauth handshake')
    expect(skipped).not.toContainEqual({
      file: 'app/api/auth/[...nextauth]/route.ts',
      reason: 'auth plumbing route, excluded',
    })
  })
})
