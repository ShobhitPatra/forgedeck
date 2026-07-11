import { describe, it, expect } from 'vitest'
import { compile } from '../src/compile'
import { toToolsManifest } from '../src/emit/tools'

describe('toToolsManifest', () => {
  const manifest = toToolsManifest(compile('tests/fixtures/mini-shop'))

  it('emits one tool per action with json schema inputs', () => {
    expect(manifest.app).toBe('mini-shop')
    expect(manifest.tools).toHaveLength(4)
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
