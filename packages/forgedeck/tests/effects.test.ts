import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { classifyEffect } from '../src/extract/effects'

describe('classifyEffect', () => {
  it('classifies prisma reads as read', () => {
    const r = classifyEffect('const p = await prisma.product.findMany()', { method: 'GET' })
    expect(r).toMatchObject({ effect: 'read', entitiesTouched: ['Product'] })
    expect(r.evidence).toContain('effect read via prisma.product.findMany')
    expect(r.external).toEqual([])
  })
  it('classifies prisma writes as write', () => {
    const r = classifyEffect('await prisma.order.create({ data })', { method: 'POST' })
    expect(r).toMatchObject({ effect: 'write', entitiesTouched: ['Order'] })
    expect(r.evidence).toContain('effect write via prisma.order.create')
  })
  it('detects the common db client alias', () => {
    const r = classifyEffect('await db.order.create({ data })', { method: 'POST' })
    expect(r).toMatchObject({ effect: 'write', entitiesTouched: ['Order'] })
    expect(r.evidence).toContain('effect write via db.order.create')
  })
  it('treats mutating http methods as write even without prisma evidence', () => {
    expect(classifyEffect('return ok()', { method: 'DELETE' }).effect).toBe('write')
  })
  it('defaults server actions with no evidence to write, conservative', () => {
    expect(classifyEffect('return somethingOpaque()', {}).effect).toBe('write')
  })
  it('follows calls into project files up to depth 3 with evidence', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    project.createSourceFile(
      '/lib/svc.ts',
      `
    import { prisma } from './db'
    export async function record() { await prisma.order.create({ data: {} }) }
  `,
    )
    const sf = project.createSourceFile(
      '/app/api/x/route.ts',
      `
    import { record } from '../../../lib/svc'
    export async function POST() { await record(); return new Response('') }
  `,
    )
    const r = classifyEffect(sf.getFunction('POST')!.getBodyText()!, { method: 'POST', sf })
    expect(r.effect).toBe('write')
    expect(r.entitiesTouched).toEqual(['Order'])
    expect(r.evidence.join(' ')).toContain('record -> prisma.order.create')
  })
  it('detects stripe as external write with evidence', () => {
    const r = classifyEffect(`await stripe.charges.create({ amount: 1 })`, { method: 'POST' })
    expect(r.effect).toBe('write')
    expect(r.external).toContain('stripe')
    expect(r.evidence.join(' ')).toContain('stripe')
  })
  it('classifies an external only handler as write with no entities', () => {
    const r = classifyEffect(`await sendEmail({ to: 'a@b.c' })`, { method: 'POST' })
    expect(r.effect).toBe('write')
    expect(r.entitiesTouched).toEqual([])
    expect(r.external).toContain('email')
  })
  it('recognises the wrapped prisma.client accessor as a read with written-form evidence', () => {
    const r = classifyEffect('const rows = await prisma.client.document.findMany()', {
      method: 'GET',
    })
    expect(r).toMatchObject({ effect: 'read', entitiesTouched: ['Document'] })
    expect(r.evidence).toContain('effect read via prisma.client.document.findMany')
  })
  it('recognises the wrapped db.client accessor for writes', () => {
    const r = classifyEffect('await db.client.order.create({ data })', { method: 'POST' })
    expect(r).toMatchObject({ effect: 'write', entitiesTouched: ['Order'] })
    expect(r.evidence).toContain('effect write via db.client.order.create')
  })
  it('relaxes an unresolved awaited call in a GET handler to read, evidence unverified', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const sf = project.createSourceFile(
      '/app/api/y/route.ts',
      `export async function GET() { await mysteryHelper() }`,
    )
    const r = classifyEffect(sf.getFunction('GET')!.getBodyText()!, { method: 'GET', sf })
    expect(r.effect).toBe('read')
    expect(r.evidence.join(' ')).toContain('unresolved call mysteryHelper, unverified')
  })
  it('keeps the conservative write default for an unresolved awaited call under a non GET method', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const sf = project.createSourceFile(
      '/app/api/z/route.ts',
      `export async function POST() { await mysteryHelper() }`,
    )
    const r = classifyEffect(sf.getFunction('POST')!.getBodyText()!, { method: 'POST', sf })
    expect(r.effect).toBe('write')
    expect(r.evidence.join(' ')).toContain('unresolved call mysteryHelper, conservative')
  })
  it('does not relax a GET handler that carries any other write signal', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const sf = project.createSourceFile(
      '/app/api/w/route.ts',
      `export async function GET() { await prisma.order.create({ data: {} }); await mysteryHelper() }`,
    )
    const r = classifyEffect(sf.getFunction('GET')!.getBodyText()!, { method: 'GET', sf })
    expect(r.effect).toBe('write')
    expect(r.entitiesTouched).toContain('Order')
  })
})
