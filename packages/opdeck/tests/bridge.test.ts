import { describe, it, expect, afterEach } from 'vitest'
import { createBridgeHandler } from '../src/bridge'

// The bridge runtime reads its shared secret from OPDECK_BRIDGE_TOKEN and gates on
// the `x-opdeck-bridge-token` request header. Save/restore so cases are isolated.
const saved = process.env.OPDECK_BRIDGE_TOKEN
afterEach(() => {
  if (saved === undefined) delete process.env.OPDECK_BRIDGE_TOKEN
  else process.env.OPDECK_BRIDGE_TOKEN = saved
})

function post(body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://app.test/api/.agent/delete_survey', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('createBridgeHandler — lock 2 (invisible posture)', () => {
  it('404s with an empty body when OPDECK_BRIDGE_TOKEN is unset', async () => {
    delete process.env.OPDECK_BRIDGE_TOKEN
    const handler = createBridgeHandler(async () => ({ ok: true }))
    const res = await handler(post({ id: 'x' }, { 'x-opdeck-bridge-token': 'anything' }))
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('')
  })

  it('404s when the token header is missing', async () => {
    process.env.OPDECK_BRIDGE_TOKEN = 'secret'
    const handler = createBridgeHandler(async () => ({ ok: true }))
    const res = await handler(post({ id: 'x' }))
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('')
  })

  it('404s when the token header is wrong', async () => {
    process.env.OPDECK_BRIDGE_TOKEN = 'secret'
    const handler = createBridgeHandler(async () => ({ ok: true }))
    const res = await handler(post({ id: 'x' }, { 'x-opdeck-bridge-token': 'nope' }))
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('')
  })
})

describe('createBridgeHandler — happy path', () => {
  it('invokes fn with the parsed body and returns its result as JSON', async () => {
    process.env.OPDECK_BRIDGE_TOKEN = 'secret'
    let received: unknown
    const handler = createBridgeHandler(async (arg: { id: string }) => {
      received = arg
      return { deleted: arg.id }
    })
    const res = await handler(post({ id: 'abc' }, { 'x-opdeck-bridge-token': 'secret' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ deleted: 'abc' })
    expect(received).toEqual({ id: 'abc' })
  })

  it('passes undefined when the request body is empty', async () => {
    process.env.OPDECK_BRIDGE_TOKEN = 'secret'
    let received: unknown = 'unset'
    const handler = createBridgeHandler(async (arg: unknown) => {
      received = arg
      return { ran: true }
    })
    const res = await handler(post(undefined, { 'x-opdeck-bridge-token': 'secret' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ran: true })
    expect(received).toBeUndefined()
  })
})

describe('createBridgeHandler — lock 3 (never swallow the app’s own auth)', () => {
  it('propagates errors thrown by fn instead of catching them', async () => {
    process.env.OPDECK_BRIDGE_TOKEN = 'secret'
    const handler = createBridgeHandler(async () => {
      throw new Error('Unauthorized: no session')
    })
    await expect(handler(post({ id: 'x' }, { 'x-opdeck-bridge-token': 'secret' }))).rejects.toThrow(
      'Unauthorized: no session',
    )
  })
})
