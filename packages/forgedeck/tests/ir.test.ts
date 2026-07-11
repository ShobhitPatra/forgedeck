import { describe, it, expect } from 'vitest'
import { validateIR } from '../src/ir/types'

const minimal = {
  app: { name: 'x', framework: 'nextjs-app-router' },
  entities: [],
  actions: [
    {
      name: 'get_products',
      kind: 'route',
      method: 'GET',
      path: '/api/products',
      sourceFile: 'app/api/products/route.ts',
      exportName: 'GET',
      description: 'GET /api/products',
      inputs: [],
      effect: 'read',
      entitiesTouched: ['Product'],
      enabled: true,
      confidence: 'static',
    },
  ],
  coverage: { extracted: 1, skipped: [] },
}

describe('validateIR', () => {
  it('accepts a valid IR', () => {
    expect(validateIR(minimal).actions[0].name).toBe('get_products')
  })
  it('rejects enabled write actions', () => {
    const bad = structuredClone(minimal)
    bad.actions[0].effect = 'write'
    expect(() => validateIR(bad)).toThrow()
  })
})
