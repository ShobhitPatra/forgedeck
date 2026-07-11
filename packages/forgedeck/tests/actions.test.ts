import { describe, it, expect } from 'vitest'
import { loadProject } from '../src/load/project'
import { extractServerActions } from '../src/extract/actions'
import { fakeLoaded } from './helpers'

describe('extractServerActions', () => {
  const { actions, skipped } = extractServerActions(loadProject('tests/fixtures/mini-shop'))

  it('extracts addToCart as a disabled write action', () => {
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      name: 'add_to_cart',
      kind: 'server-action',
      exportName: 'addToCart',
      effect: 'write',
      enabled: false,
      entitiesTouched: ['Product'],
      sourceFile: 'app/actions/cart.ts',
    })
    expect(actions[0].inputs).toEqual([
      { name: 'productId', type: 'string', required: true, location: 'body' },
      { name: 'quantity', type: 'number', required: true, location: 'body' },
    ])
    expect(skipped).toEqual([])
  })
})

describe('extractServerActions wrapped clients', () => {
  it('unwraps a chained schema().action() client and keeps auth unknown for a neutral root', () => {
    const { actions } = extractServerActions(
      fakeLoaded({
        '/app/actions/things.ts': `'use server'
export const doThing = client.schema(z).action(async (input: { id: string }) => {
  return db.thing.findMany({ where: { id: input.id } })
})`,
      }),
    )
    const thing = actions.find((a) => a.name === 'do_thing')!
    expect(thing).toMatchObject({ kind: 'server-action', effect: 'read', auth: 'unknown' })
    expect(thing.evidence).toContain('wrapped server action via client')
  })

  it('marks auth required when the client root name signals authentication', () => {
    const { actions } = extractServerActions(
      fakeLoaded({
        '/app/actions/secure.ts': `'use server'
export const removeIt = authenticatedActionClient.action(async (input: { id: string }) => {
  return db.thing.delete({ where: { id: input.id } })
})`,
      }),
    )
    const remove = actions.find((a) => a.name === 'remove_it')!
    expect(remove).toMatchObject({ effect: 'write', enabled: false, auth: 'required' })
    expect(remove.evidence).toContain('wrapped server action via authenticatedActionClient')
  })

  it('skip-logs a chained action whose handler cannot be resolved', () => {
    const { skipped } = extractServerActions(
      fakeLoaded({
        '/app/actions/opaque.ts': `'use server'
export const opaque = protectedClient.action(someUnknownHandler)`,
      }),
    )
    expect(skipped).toContainEqual({
      file: 'app/actions/opaque.ts',
      reason: 'wrapped server action not resolved: protectedClient',
    })
  })
})

describe('extractServerActions hybrid-shop wrapped action integration', () => {
  it('extracts delete_survey through the authenticatedActionClient', () => {
    const { actions } = extractServerActions(loadProject('tests/fixtures/hybrid-shop'))
    const del = actions.find((a) => a.name === 'delete_survey')!
    expect(del).toMatchObject({
      kind: 'server-action',
      effect: 'write',
      enabled: false,
      entitiesTouched: ['Document'],
      auth: 'required',
    })
    expect(del.evidence).toContain('wrapped server action via authenticatedActionClient')
  })
})

describe('extractServerActions edge cases', () => {
  it('extracts exported const arrow actions and skip logs function level directives', () => {
    const { actions, skipped } = extractServerActions(
      fakeLoaded({
        '/app/actions/misc.ts': `'use server'\nexport const renameItem = async (id: string) => { return id }`,
        '/app/lib/mixed.ts': `export async function inlineAction() { 'use server'\n return 1 }`,
      }),
    )
    expect(actions.map((a) => a.name)).toContain('rename_item')
    expect(skipped).toContainEqual({
      file: 'app/lib/mixed.ts',
      reason: 'function level use server directive, not yet supported',
    })
  })
})
