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
