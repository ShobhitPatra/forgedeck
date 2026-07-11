import { describe, it, expect } from 'vitest'
import { classifyEffect } from '../src/extract/effects'

describe('classifyEffect', () => {
  it('classifies prisma reads as read', () => {
    const r = classifyEffect('const p = await prisma.product.findMany()', { method: 'GET' })
    expect(r).toEqual({ effect: 'read', entitiesTouched: ['Product'] })
  })
  it('classifies prisma writes as write', () => {
    const r = classifyEffect('await prisma.order.create({ data })', { method: 'POST' })
    expect(r).toEqual({ effect: 'write', entitiesTouched: ['Order'] })
  })
  it('detects the common db client alias', () => {
    const r = classifyEffect('await db.order.create({ data })', { method: 'POST' })
    expect(r).toEqual({ effect: 'write', entitiesTouched: ['Order'] })
  })
  it('treats mutating http methods as write even without prisma evidence', () => {
    expect(classifyEffect('return ok()', { method: 'DELETE' }).effect).toBe('write')
  })
  it('defaults server actions with no evidence to write, conservative', () => {
    expect(classifyEffect('return somethingOpaque()', {}).effect).toBe('write')
  })
})
