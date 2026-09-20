import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractEntities, extractEntitiesWithSource } from '../src/extract/entities'

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
  it('resolves a schema from the workspace root when the package has none', () => {
    const entities = extractEntities('tests/fixtures/workspace-shop/apps/web')
    expect(entities.map((e) => e.name)).toEqual(['Widget'])
    const widget = entities[0]
    expect(widget.fields.map((f) => f.name)).toEqual(['id', 'label'])
    expect(widget.sourceFile).toBe('packages/database/prisma/schema.prisma')
  })
  it('surfaces a workspace note only when entities came from a workspace walk', () => {
    const walked = extractEntitiesWithSource('tests/fixtures/workspace-shop/apps/web')
    expect(walked.entities.map((e) => e.name)).toEqual(['Widget'])
    expect(walked.workspaceNote).toEqual({
      file: 'packages/database/prisma/schema.prisma',
      reason: 'entities resolved from workspace package',
    })
    const local = extractEntitiesWithSource('tests/fixtures/hybrid-shop')
    expect(local.workspaceNote).toBeUndefined()
  })
  it('resolves a flat packages/*/schema.prisma from a workspace package', () => {
    const entities = extractEntities('tests/fixtures/flatdb-shop/apps/web')
    expect(entities.map((e) => e.name)).toEqual(['Gadget'])
    const gadget = entities[0]
    expect(gadget.fields.map((f) => f.name)).toEqual(['id', 'name'])
    expect(gadget.sourceFile).toBe('packages/database/schema.prisma')
  })
  it('emits the workspace note for a flat schema resolved by walking up', () => {
    const walked = extractEntitiesWithSource('tests/fixtures/flatdb-shop/apps/web')
    expect(walked.workspaceNote).toEqual({
      file: 'packages/database/schema.prisma',
      reason: 'entities resolved from workspace package',
    })
  })
  it('honors a prisma.config schema literal at the project root pointing at a nonstandard path', () => {
    const root = mkdtempSync(join(tmpdir(), 'fd-cfg-own-'))
    try {
      mkdirSync(join(root, 'db'), { recursive: true })
      writeFileSync(
        join(root, 'prisma.config.ts'),
        "export default { schema: './db/main.prisma' }\n",
      )
      writeFileSync(join(root, 'db', 'main.prisma'), 'model Thing {\n  id String @id\n}\n')
      const entities = extractEntities(root)
      expect(entities.map((e) => e.name)).toEqual(['Thing'])
      expect(entities[0].sourceFile).toBe('db/main.prisma')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('honors a prisma.config schema literal in a workspace package the glob order would miss', () => {
    const root = mkdtempSync(join(tmpdir(), 'fd-cfg-ws-'))
    try {
      writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
      mkdirSync(join(root, 'packages', 'db', 'config'), { recursive: true })
      writeFileSync(
        join(root, 'packages', 'db', 'prisma.config.mjs'),
        "export default { schema: './config/main.prisma' }\n",
      )
      writeFileSync(
        join(root, 'packages', 'db', 'config', 'main.prisma'),
        'model Thing {\n  id String @id\n}\n',
      )
      mkdirSync(join(root, 'apps', 'web'), { recursive: true })
      const walked = extractEntitiesWithSource(join(root, 'apps', 'web'))
      expect(walked.entities.map((e) => e.name)).toEqual(['Thing'])
      expect(walked.entities[0].sourceFile).toBe('packages/db/config/main.prisma')
      expect(walked.workspaceNote).toEqual({
        file: 'packages/db/config/main.prisma',
        reason: 'entities resolved from workspace package',
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
