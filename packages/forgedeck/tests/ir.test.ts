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
      inputs: [{ name: 'id', type: 'string', required: true, location: 'path' }],
      effect: 'read',
      entitiesTouched: ['Product'],
      enabled: true,
      confidence: 'static',
      auth: 'unknown',
      evidence: [],
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
  it('accepts hybrid framework and pages api kind', () => {
    const hybrid = structuredClone(minimal)
    hybrid.app.framework = 'nextjs-hybrid'
    hybrid.actions[0].kind = 'pages-api'
    expect(validateIR(hybrid).app.framework).toBe('nextjs-hybrid')
  })
  it('rejects an input without location', () => {
    const bad = structuredClone(minimal)
    delete (bad.actions[0].inputs[0] as Record<string, unknown>).location
    expect(() => validateIR(bad)).toThrow()
  })
  it('rejects an action missing auth or evidence', () => {
    const bad = structuredClone(minimal)
    delete (bad.actions[0] as Record<string, unknown>).auth
    expect(() => validateIR(bad)).toThrow()
    const bad2 = structuredClone(minimal)
    delete (bad2.actions[0] as Record<string, unknown>).evidence
    expect(() => validateIR(bad2)).toThrow()
  })
})
