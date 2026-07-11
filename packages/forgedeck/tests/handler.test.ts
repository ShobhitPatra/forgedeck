import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createForgedeckHandler, resolveBundleDir, resolveTargetUrl } from '../src/next/handler'
import { registerTools, buildToolHandlers, type ToolRegistrar } from '../src/mcp/core'
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
    {
      name: 'post_orders',
      description: 'POST /api/orders',
      inputSchema: { type: 'object', properties: {}, required: [] },
      kind: 'route',
      method: 'POST',
      path: '/api/orders',
      effect: 'write',
      auth: 'none',
      enabled: false,
    },
  ],
}

const savedToken = process.env.FORGEDECK_MCP_TOKEN
const savedTarget = process.env.FORGEDECK_TARGET_URL
const savedPort = process.env.PORT

afterEach(() => {
  const restore = (k: string, v: string | undefined) =>
    v === undefined ? delete process.env[k] : (process.env[k] = v)
  restore('FORGEDECK_MCP_TOKEN', savedToken)
  restore('FORGEDECK_TARGET_URL', savedTarget)
  restore('PORT', savedPort)
})

/** A transport spy that records the Request it was handed and returns a sentinel. */
function mockDeps() {
  const sentinel = new Response('{"jsonrpc":"2.0","result":{},"id":1}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  const handleRequest = vi.fn(async () => sentinel)
  const connect = vi.fn(async () => {})
  return {
    sentinel,
    handleRequest,
    connect,
    opts: {
      manifest,
      targetUrl: 'http://localhost:3000',
      transportFactory: () => ({ handleRequest }),
      serverFactory: () => ({ connect }),
    },
  }
}

function post(headers: Record<string, string> = {}) {
  return new Request('http://app.local/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
  })
}

describe('createForgedeckHandler — locked-by-default 404 posture', () => {
  it('404s EVERY request (GET and POST) when FORGEDECK_MCP_TOKEN is unset', async () => {
    delete process.env.FORGEDECK_MCP_TOKEN
    const { opts, handleRequest, connect } = mockDeps()
    const { GET, POST } = createForgedeckHandler(opts)

    const postRes = await POST(post({ authorization: 'Bearer anything' }))
    const getRes = await GET(new Request('http://app.local/api/mcp', { method: 'GET' }))

    expect(postRes.status).toBe(404)
    expect(getRes.status).toBe(404)
    expect(await postRes.text()).toBe('')
    // The gate short-circuits before any transport/server work happens.
    expect(handleRequest).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })

  it('404s when the Authorization header is missing entirely', async () => {
    process.env.FORGEDECK_MCP_TOKEN = 'sekret'
    const { opts, handleRequest } = mockDeps()
    const { POST } = createForgedeckHandler(opts)
    const res = await POST(post())
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('')
    expect(handleRequest).not.toHaveBeenCalled()
  })

  it('404s when the bearer token does not match', async () => {
    process.env.FORGEDECK_MCP_TOKEN = 'sekret'
    const { opts, handleRequest } = mockDeps()
    const { POST } = createForgedeckHandler(opts)
    const res = await POST(post({ authorization: 'Bearer wrong' }))
    expect(res.status).toBe(404)
    expect(handleRequest).not.toHaveBeenCalled()
  })

  it('404s on a malformed Authorization header (no Bearer prefix)', async () => {
    process.env.FORGEDECK_MCP_TOKEN = 'sekret'
    const { opts } = mockDeps()
    const { POST } = createForgedeckHandler(opts)
    expect((await POST(post({ authorization: 'sekret' }))).status).toBe(404)
  })
})

describe('createForgedeckHandler — serving an authorized request', () => {
  it('on an exact bearer match, connects the server and returns the transport Response', async () => {
    process.env.FORGEDECK_MCP_TOKEN = 'sekret'
    const { opts, handleRequest, connect, sentinel } = mockDeps()
    const { POST } = createForgedeckHandler(opts)

    const req = post({ authorization: 'Bearer sekret' })
    const res = await POST(req)

    expect(connect).toHaveBeenCalledOnce()
    expect(handleRequest).toHaveBeenCalledOnce()
    // The exact incoming Request is handed to the transport untouched.
    expect(handleRequest).toHaveBeenCalledWith(req)
    // The transport's Response is returned verbatim.
    expect(res).toBe(sentinel)
  })

  it('mints a FRESH transport and server per request (stateless, no reuse)', async () => {
    process.env.FORGEDECK_MCP_TOKEN = 'sekret'
    const transports: object[] = []
    const servers: object[] = []
    const { POST } = createForgedeckHandler({
      manifest,
      targetUrl: 'http://localhost:3000',
      transportFactory: () => {
        const t = { handleRequest: vi.fn(async () => new Response(null)) }
        transports.push(t)
        return t
      },
      serverFactory: () => {
        const s = { connect: vi.fn(async () => {}) }
        servers.push(s)
        return s
      },
    })
    await POST(post({ authorization: 'Bearer sekret' }))
    await POST(post({ authorization: 'Bearer sekret' }))
    expect(transports).toHaveLength(2)
    expect(transports[0]).not.toBe(transports[1])
    expect(servers).toHaveLength(2)
    expect(servers[0]).not.toBe(servers[1])
  })
})

describe('resolveTargetUrl', () => {
  it('defaults to localhost:3000 (self-target)', () => {
    delete process.env.FORGEDECK_TARGET_URL
    delete process.env.PORT
    expect(resolveTargetUrl()).toBe('http://localhost:3000')
  })
  it('honors PORT for the self-target default', () => {
    delete process.env.FORGEDECK_TARGET_URL
    process.env.PORT = '3006'
    expect(resolveTargetUrl()).toBe('http://localhost:3006')
  })
  it('FORGEDECK_TARGET_URL overrides everything', () => {
    process.env.FORGEDECK_TARGET_URL = 'https://app.example.com'
    process.env.PORT = '3006'
    expect(resolveTargetUrl()).toBe('https://app.example.com')
  })
})

describe('resolveBundleDir', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fd-bundle-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('resolves <cwd>/.agent first when it contains tools.json', () => {
    const agent = join(root, '.agent')
    mkdirSync(agent)
    writeFileSync(join(agent, 'tools.json'), JSON.stringify(manifest))
    expect(resolveBundleDir({ cwd: root, moduleDir: '/somewhere/else' })).toBe(agent)
  })

  it('falls back to a module-relative .agent when cwd has none (traced layout)', () => {
    // cwd has NO .agent; the bundle sits beside a nested "compiled route" module.
    const cwd = mkdtempSync(join(tmpdir(), 'fd-cwd-'))
    const agent = join(root, '.agent')
    mkdirSync(agent)
    writeFileSync(join(agent, 'tools.json'), JSON.stringify(manifest))
    const nestedModule = join(root, '.next', 'server', 'app', 'api', 'mcp')
    mkdirSync(nestedModule, { recursive: true })
    expect(resolveBundleDir({ cwd, moduleDir: nestedModule })).toBe(agent)
    rmSync(cwd, { recursive: true, force: true })
  })

  it('cwd/.agent wins over a module-relative candidate when both exist', () => {
    const cwdAgent = join(root, '.agent')
    mkdirSync(cwdAgent)
    writeFileSync(join(cwdAgent, 'tools.json'), '{}')
    const modRoot = mkdtempSync(join(tmpdir(), 'fd-mod-'))
    const modAgent = join(modRoot, '.agent')
    mkdirSync(modAgent)
    writeFileSync(join(modAgent, 'tools.json'), '{}')
    expect(resolveBundleDir({ cwd: root, moduleDir: modRoot })).toBe(cwdAgent)
    rmSync(modRoot, { recursive: true, force: true })
  })

  it('throws LOUDLY listing every tried path when no bundle exists', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fd-empty-'))
    try {
      resolveBundleDir({ cwd, moduleDir: '/no/such/dir' })
      throw new Error('should have thrown')
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).toContain('could not locate the .agent bundle')
      expect(msg).toContain(join(cwd, '.agent'))
      expect(msg).toContain('/no/such/dir/.agent')
    }
    rmSync(cwd, { recursive: true, force: true })
  })
})

describe('tool-listing parity: stdio core and HTTP handler register the same set', () => {
  // Both transports register tools through the shared registerTools() over the SAME
  // buildToolHandlers() output — so parity is structural. This pins it down.
  function recordRegistered(m: ToolsManifest): string[] {
    const registered: string[] = []
    const spy: ToolRegistrar = {
      registerTool(name) {
        registered.push(name)
        return {}
      },
    }
    registerTools(spy, m, 'http://localhost:3000')
    return registered.sort()
  }

  it('registers exactly the enabled tools from buildToolHandlers, nothing more', () => {
    const expected = [...buildToolHandlers(manifest, 'http://localhost:3000').keys()].sort()
    expect(recordRegistered(manifest)).toEqual(expected)
    // Concretely: the enabled GET tool is in; the disabled POST tool is out.
    expect(recordRegistered(manifest)).toEqual(['get_products'])
  })

  it('is deterministic — same manifest in, same tool set out across builds', () => {
    expect(recordRegistered(manifest)).toEqual(recordRegistered(structuredClone(manifest)))
  })
})
