import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildToolHandlers, parseTargetHeaders } from '../src/mcp/server'
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

  it('injects opts.headers on GET proxied requests', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}'))
    const handlers = buildToolHandlers(
      manifest,
      'http://localhost:3005',
      fetchMock as unknown as typeof fetch,
      { headers: { authorization: 'Bearer secret' } },
    )
    await handlers.get('get_products')!.run({})
    const [, init] = fetchMock.mock.calls[0]
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer secret' })
  })

  it('injects opts.headers on POST proxied requests', async () => {
    const postManifest: ToolsManifest = {
      app: 'mini-shop',
      tools: [{ ...manifest.tools[2], enabled: true }],
    }
    const fetchMock = vi.fn(async () => new Response('{"ok":true}'))
    const handlers = buildToolHandlers(
      postManifest,
      'http://localhost:3005',
      fetchMock as unknown as typeof fetch,
      { headers: { authorization: 'Bearer secret' } },
    )
    await handlers.get('post_orders')!.run({ item: 'x' })
    const [, init] = fetchMock.mock.calls[0]
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer secret' })
  })

  it('registers an enabled pages-api tool and POSTs to its address', async () => {
    const pagesManifest: ToolsManifest = {
      app: 'hybrid-shop',
      tools: [
        {
          name: 'post_documents',
          description: 'POST /api/documents',
          inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: [] },
          kind: 'pages-api',
          method: 'POST',
          path: '/api/documents',
          effect: 'write',
          enabled: true,
        },
      ],
    }
    const fetchMock = vi.fn(async () => new Response('{"id":"d1"}'))
    const handlers = buildToolHandlers(
      pagesManifest,
      'http://localhost:3005',
      fetchMock as unknown as typeof fetch,
    )
    expect([...handlers.keys()]).toEqual(['post_documents'])
    await handlers.get('post_documents')!.run({ title: 'hello' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3005/api/documents')
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).body).toBe(JSON.stringify({ title: 'hello' }))
  })

  it('request content-type wins over an injected content-type on POST', async () => {
    const postManifest: ToolsManifest = {
      app: 'mini-shop',
      tools: [{ ...manifest.tools[2], enabled: true }],
    }
    const fetchMock = vi.fn(async () => new Response('{"ok":true}'))
    const handlers = buildToolHandlers(
      postManifest,
      'http://localhost:3005',
      fetchMock as unknown as typeof fetch,
      { headers: { 'content-type': 'text/plain', authorization: 'Bearer secret' } },
    )
    await handlers.get('post_orders')!.run({ item: 'x' })
    const [, init] = fetchMock.mock.calls[0]
    expect((init as RequestInit).headers).toMatchObject({
      'content-type': 'application/json',
      authorization: 'Bearer secret',
    })
  })
})

describe('buildToolHandlers — bridge dispatch for server actions', () => {
  const savedToken = process.env.FORGEDECK_BRIDGE_TOKEN
  afterEach(() => {
    if (savedToken === undefined) delete process.env.FORGEDECK_BRIDGE_TOKEN
    else process.env.FORGEDECK_BRIDGE_TOKEN = savedToken
  })

  const actionManifest = (enabled: boolean): ToolsManifest => ({
    app: 'hybrid-shop',
    tools: [
      {
        name: 'delete_survey',
        description: 'server action deleteSurvey',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        kind: 'server-action',
        effect: 'irreversible',
        enabled,
      },
    ],
  })

  it('dispatches an enabled server action to its bridge URL with the token header and JSON body', async () => {
    process.env.FORGEDECK_BRIDGE_TOKEN = 'secret-token'
    const fetchMock = vi.fn(async () => new Response('{"deleted":"s1"}'))
    const handlers = buildToolHandlers(
      actionManifest(true),
      'http://localhost:3005/',
      fetchMock as unknown as typeof fetch,
      { headers: { authorization: 'Bearer creds' } },
    )
    expect([...handlers.keys()]).toEqual(['delete_survey'])
    const out = await handlers.get('delete_survey')!.run({ id: 's1' })
    expect(out).toBe('{"deleted":"s1"}')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3005/api/.agent/delete_survey')
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).body).toBe(JSON.stringify({ id: 's1' }))
    expect((init as RequestInit).headers).toMatchObject({
      'x-forgedeck-bridge-token': 'secret-token',
      authorization: 'Bearer creds',
      'content-type': 'application/json',
    })
  })

  it('omits the token header when FORGEDECK_BRIDGE_TOKEN is unset', async () => {
    delete process.env.FORGEDECK_BRIDGE_TOKEN
    const fetchMock = vi.fn(async () => new Response('{}'))
    const handlers = buildToolHandlers(
      actionManifest(true),
      'http://localhost:3005',
      fetchMock as unknown as typeof fetch,
    )
    await handlers.get('delete_survey')!.run({ id: 's1' })
    const [, init] = fetchMock.mock.calls[0]
    expect((init as RequestInit).headers).not.toHaveProperty('x-forgedeck-bridge-token')
  })

  it('does not register a disabled server action', () => {
    const handlers = buildToolHandlers(actionManifest(false), 'http://localhost:3005')
    expect(handlers.has('delete_survey')).toBe(false)
    expect([...handlers.keys()]).toEqual([])
  })
})

describe('buildToolHandlers — dispatch honesty on upstream failures', () => {
  const savedToken = process.env.FORGEDECK_BRIDGE_TOKEN
  afterEach(() => {
    if (savedToken === undefined) delete process.env.FORGEDECK_BRIDGE_TOKEN
    else process.env.FORGEDECK_BRIDGE_TOKEN = savedToken
  })

  const bridgeManifest: ToolsManifest = {
    app: 'hybrid-shop',
    tools: [
      {
        name: 'delete_survey',
        description: 'server action deleteSurvey',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        kind: 'server-action',
        effect: 'irreversible',
        enabled: true,
      },
    ],
  }

  it('surfaces a 404 with empty body as a bare HTTP error string', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 404, statusText: 'Not Found' }))
    const handlers = buildToolHandlers(
      manifest,
      'http://localhost:3005',
      fetchMock as unknown as typeof fetch,
    )
    const out = await handlers.get('get_products')!.run({})
    expect(out).toBe('HTTP 404 Not Found')
  })

  it('surfaces a 500 including the upstream body text', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('boom: db offline', { status: 500, statusText: 'Internal Server Error' }),
    )
    const handlers = buildToolHandlers(
      manifest,
      'http://localhost:3005',
      fetchMock as unknown as typeof fetch,
    )
    const out = await handlers.get('get_products')!.run({})
    expect(out).toContain('HTTP 500 Internal Server Error')
    expect(out).toContain('boom: db offline')
  })

  it('passes a 2xx body through unchanged', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    const handlers = buildToolHandlers(
      manifest,
      'http://localhost:3005',
      fetchMock as unknown as typeof fetch,
    )
    const out = await handlers.get('get_products')!.run({})
    expect(out).toBe('{"ok":true}')
  })

  it('surfaces upstream failure on the server-action bridge path too', async () => {
    process.env.FORGEDECK_BRIDGE_TOKEN = 'secret-token'
    const fetchMock = vi.fn(
      async () => new Response('nope', { status: 403, statusText: 'Forbidden' }),
    )
    const handlers = buildToolHandlers(
      bridgeManifest,
      'http://localhost:3005',
      fetchMock as unknown as typeof fetch,
    )
    const out = await handlers.get('delete_survey')!.run({ id: 's1' })
    expect(out).toContain('HTTP 403 Forbidden')
    expect(out).toContain('nope')
  })
})

describe('parseTargetHeaders', () => {
  it('returns undefined for undefined input', () => {
    expect(parseTargetHeaders(undefined)).toBeUndefined()
  })
  it('parses a JSON object of headers', () => {
    expect(parseTargetHeaders('{"authorization":"Bearer x"}')).toEqual({
      authorization: 'Bearer x',
    })
  })
  it('warns and ignores malformed JSON', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(parseTargetHeaders('{not json')).toBeUndefined()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
  it('warns and ignores non-object JSON', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(parseTargetHeaders('"a string"')).toBeUndefined()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
