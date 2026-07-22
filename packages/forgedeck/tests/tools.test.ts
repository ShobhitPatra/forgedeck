import { describe, it, expect, beforeAll } from 'vitest'
import { compile } from '../src/compile'
import { toToolsManifest, type ToolsManifest } from '../src/emit/tools'

describe('toToolsManifest', () => {
  let manifest: ToolsManifest
  beforeAll(async () => {
    manifest = toToolsManifest(await compile('tests/fixtures/mini-shop'))
  })

  it('emits one tool per action with json schema inputs', () => {
    expect(manifest.app).toBe('mini-shop')
    expect(manifest.tools).toHaveLength(5)
    const create = manifest.tools.find((t) => t.name === 'post_orders')!
    expect(create.inputSchema).toEqual({
      type: 'object',
      properties: {
        email: { type: 'string' },
        productId: { type: 'string' },
        quantity: { type: 'number' },
      },
      required: ['email', 'productId', 'quantity'],
    })
    expect(create.enabled).toBe(false)
  })

  it('every tool carries an auth requirement', () => {
    for (const t of manifest.tools) {
      expect(['none', 'required', 'unknown']).toContain(t.auth)
    }
  })
})

describe('toToolsManifest preconditions (hybrid-shop)', () => {
  let manifest: ToolsManifest
  beforeAll(async () => {
    manifest = toToolsManifest(await compile('tests/fixtures/hybrid-shop'))
  })

  it('appends preconditions to the tool description so the agent sees them at call time', () => {
    const del = manifest.tools.find((t) => t.name === 'delete_survey')!
    expect(del.description).toContain('Preconditions: account must be in good standing')
  })

  it('leaves descriptions untouched when an action has no preconditions', () => {
    const health = manifest.tools.find((t) => t.name === 'get_health')!
    expect(health.description).not.toContain('Preconditions:')
  })
})
