import { describe, it, expect, afterEach } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  nodeToFetchRequest,
  writeFetchResponse,
  startHttpMcpServer,
  type HttpMcpServerHandle,
} from '../src/serve-http'
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
      auth: 'none',
      enabled: true,
    },
  ],
}

const savedToken = process.env.FORGEDECK_MCP_TOKEN
afterEach(() => {
  if (savedToken === undefined) delete process.env.FORGEDECK_MCP_TOKEN
  else process.env.FORGEDECK_MCP_TOKEN = savedToken
})

/** Build a minimal IncomingMessage from a body buffer + method/url/headers. */
function fakeReq(opts: {
  method?: string
  url?: string
  headers?: Record<string, string | string[]>
  body?: string
}): IncomingMessage {
  const stream = Readable.from(
    opts.body === undefined ? [] : [Buffer.from(opts.body)],
  ) as unknown as IncomingMessage
  stream.method = opts.method ?? 'GET'
  stream.url = opts.url ?? '/'
  stream.headers = { host: 'app.local', ...opts.headers }
  return stream
}

/** A ServerResponse spy that records status, headers, and the concatenated body. */
function fakeRes() {
  const chunks: Buffer[] = []
  const rec = { status: 0, headers: {} as Record<string, string | string[]>, ended: false }
  const res = {
    writeHead(status: number, headers?: Record<string, string | string[]>) {
      rec.status = status
      if (headers) rec.headers = headers
      return res
    },
    write(chunk: Buffer | string) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      return true
    },
    end(chunk?: Buffer | string) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      rec.ended = true
    },
  } as unknown as ServerResponse
  return { res, rec, body: () => Buffer.concat(chunks).toString('utf8') }
}

describe('nodeToFetchRequest — Node -> Fetch adaptation', () => {
  it('carries method, URL, and headers across', async () => {
    const req = fakeReq({
      method: 'POST',
      url: '/api/mcp?x=1',
      headers: { authorization: 'Bearer sekret', 'content-type': 'application/json' },
      body: '{"a":1}',
    })
    const request = await nodeToFetchRequest(req)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/api/mcp')
    expect(new URL(request.url).searchParams.get('x')).toBe('1')
    expect(request.headers.get('authorization')).toBe('Bearer sekret')
    expect(request.headers.get('content-type')).toBe('application/json')
  })

  it('passes the request body through verbatim', async () => {
    const req = fakeReq({ method: 'POST', url: '/', body: '{"jsonrpc":"2.0"}' })
    const request = await nodeToFetchRequest(req)
    expect(await request.text()).toBe('{"jsonrpc":"2.0"}')
  })

  it('sends no body for GET (avoids the Fetch GET-with-body error)', async () => {
    const req = fakeReq({ method: 'GET', url: '/' })
    const request = await nodeToFetchRequest(req)
    expect(request.body).toBeNull()
  })
})

describe('writeFetchResponse — Fetch -> Node adaptation', () => {
  it('writes status, headers, and body back onto the ServerResponse', async () => {
    const response = new Response('{"ok":true}', {
      status: 207,
      headers: { 'content-type': 'application/json', 'x-test': 'yes' },
    })
    const { res, rec, body } = fakeRes()
    await writeFetchResponse(response, res)
    expect(rec.status).toBe(207)
    expect(rec.headers['content-type']).toBe('application/json')
    expect(rec.headers['x-test']).toBe('yes')
    expect(body()).toBe('{"ok":true}')
    expect(rec.ended).toBe(true)
  })

  it('ends cleanly with an empty body for a null-body 404', async () => {
    const response = new Response(null, { status: 404 })
    const { res, rec, body } = fakeRes()
    await writeFetchResponse(response, res)
    expect(rec.status).toBe(404)
    expect(body()).toBe('')
    expect(rec.ended).toBe(true)
  })
})

describe('startHttpMcpServer — token posture over a live server', () => {
  let handle: HttpMcpServerHandle
  afterEach(async () => {
    if (handle) await handle.close()
  })

  async function boot() {
    handle = await startHttpMcpServer({
      port: 0,
      bundleDir: '/unused',
      targetUrl: 'http://localhost:3000',
      // Inject the manifest so the server never hits the filesystem.
      handlerOpts: { manifest, targetUrl: 'http://localhost:3000' },
    })
    return `http://127.0.0.1:${handle.port}`
  }

  it('404s all requests when FORGEDECK_MCP_TOKEN is unset (locked by default)', async () => {
    delete process.env.FORGEDECK_MCP_TOKEN
    const base = await boot()
    const res = await fetch(`${base}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer anything' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    })
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('')
  })

  it('404s a request with the wrong bearer token', async () => {
    process.env.FORGEDECK_MCP_TOKEN = 'sekret'
    const base = await boot()
    const res = await fetch(`${base}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    })
    expect(res.status).toBe(404)
  })

  it('serves an MCP initialize + tools/list on an exact bearer match', async () => {
    process.env.FORGEDECK_MCP_TOKEN = 'sekret'
    const base = await boot()
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer sekret',
    }
    const init = await fetch(`${base}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '0' },
        },
      }),
    })
    expect(init.status).toBe(200)
    const initJson = await init.json()
    expect(initJson.result.serverInfo.name).toContain('mini-shop')

    const list = await fetch(`${base}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    })
    expect(list.status).toBe(200)
    const listJson = await list.json()
    const names = (listJson.result.tools as { name: string }[]).map((t) => t.name)
    expect(names).toEqual(['get_products'])
  })
})
