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
