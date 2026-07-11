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
