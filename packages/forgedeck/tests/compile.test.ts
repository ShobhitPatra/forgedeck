import { describe, it, expect } from 'vitest'
import { compile } from '../src/compile'

describe('compile', () => {
  const ir = compile('tests/fixtures/mini-shop')

  it('produces a complete validated IR for mini-shop', () => {
    expect(ir.app).toEqual({ name: 'mini-shop', framework: 'nextjs-app-router' })
    expect(ir.entities.map((e) => e.name)).toEqual(['Product', 'Order', 'OrderItem'])
    expect(ir.actions.map((a) => a.name).sort()).toEqual([
      'add_to_cart',
      'get_products',
      'get_products_by_id',
      'post_orders',
    ])
    expect(ir.coverage.extracted).toBe(4)
    expect(ir.coverage.skipped).toEqual([])
  })

  it('compiles the hybrid fixture across both surfaces', () => {
    const hybrid = compile('tests/fixtures/hybrid-shop')
    expect(hybrid.app.framework).toBe('nextjs-hybrid')
    const kinds = new Set(hybrid.actions.map((a) => a.kind))
    expect(kinds.has('route')).toBe(true)
    expect(kinds.has('pages-api')).toBe(true)
    expect(hybrid.entities.map((e) => e.name).sort()).toEqual(['Document', 'Product', 'User'])
  })
})
