import { describe, it, expect } from 'vitest'
import { extractEntities } from '../src/extract/entities'

const FIXTURE = 'tests/fixtures/mini-shop'

describe('extractEntities', () => {
  it('extracts models, fields and relations from schema.prisma', () => {
    const entities = extractEntities(FIXTURE)
    const names = entities.map((e) => e.name)
    expect(names).toEqual(['Product', 'Order', 'OrderItem'])

    const product = entities.find((e) => e.name === 'Product')!
    expect(product.fields).toContainEqual({ name: 'priceCents', type: 'Int', optional: false })
    expect(product.relations).toContainEqual({ field: 'orders', target: 'OrderItem' })
    expect(product.sourceFile).toBe('prisma/schema.prisma')
  })
  it('returns empty array when no schema exists', () => {
    expect(extractEntities('/nonexistent')).toEqual([])
  })
  it('extracts models from a multi file schema folder', () => {
    const entities = extractEntities('tests/fixtures/hybrid-shop')
    expect(entities.map((e) => e.name).sort()).toEqual(['Document', 'Product', 'User'])
    const doc = entities.find((e) => e.name === 'Document')!
    expect(doc.relations).toContainEqual({ field: 'owner', target: 'User' })
    expect(doc.sourceFile).toBe('prisma/schema/document.prisma')
  })
})
