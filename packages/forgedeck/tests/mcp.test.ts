import { describe, it, expect, vi } from 'vitest'
import { buildToolHandlers } from '../src/mcp/server'
import type { ToolsManifest } from '../src/emit/tools'

const manifest: ToolsManifest = {
  app: 'mini-shop',
  tools: [
    {
      name: 'get_products',
      description: 'GET /api/products',
      inputSchema: { type: 'object', properties: {}, required: [] },
      kind: 'route',
      method: 'GET',
      path: '/api/products',
      effect: 'read',
      enabled: true,
    },
    {
      name: 'get_products_by_id',
      description: 'GET /api/products/{id}',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      kind: 'route',
      method: 'GET',
      path: '/api/products/{id}',
      effect: 'read',
      enabled: true,
    },
    {
      name: 'post_orders',
      description: 'POST /api/orders',
      inputSchema: { type: 'object', properties: {}, required: [] },
      kind: 'route',
      method: 'POST',
      path: '/api/orders',
      effect: 'write',
      enabled: false,
    },
  ],
}

describe('buildToolHandlers', () => {
  it('only registers enabled tools', () => {
    const handlers = buildToolHandlers(manifest, 'http://localhost:3005')
    expect([...handlers.keys()].sort()).toEqual(['get_products', 'get_products_by_id'])
  })
  it('substitutes path params and appends query args', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}'))
    const handlers = buildToolHandlers(
      manifest,
      'http://localhost:3005',
      fetchMock as unknown as typeof fetch,
    )
    await handlers.get('get_products_by_id')!.run({ id: 'abc' })
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3005/api/products/abc', {
      method: 'GET',
    })
  })
})
