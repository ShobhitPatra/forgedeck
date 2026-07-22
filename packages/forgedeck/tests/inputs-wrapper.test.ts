import { describe, it, expect } from 'vitest'
import { compile } from '../src/compile'

describe('wrapper-call schema extraction', () => {
  it('resolves a module-level named schema passed to a GET wrapper as query fields', async () => {
    const ir = await compile('tests/fixtures/wrapper-shop')
    const get = ir.actions.find((a) => a.name === 'get_stats')
    expect(get).toBeDefined()
    const byName = Object.fromEntries(get!.inputs.map((i) => [i.name, i]))
    expect(byName.startAt).toMatchObject({ location: 'query', type: 'number', required: true })
    expect(byName.endAt).toMatchObject({ location: 'query', type: 'number', required: true })
    expect(get!.evidence.some((e) => /schema via wrapper call parseRequest/.test(e))).toBe(true)
  })

  it('resolves a handler-local named schema (umami idiom) passed to a GET wrapper as query fields', async () => {
    const ir = await compile('tests/fixtures/wrapper-shop')
    const get = ir.actions.find((a) => a.name === 'get_websites_by_website_id_stats')
    expect(get).toBeDefined()
    const byName = Object.fromEntries(get!.inputs.map((i) => [i.name, i]))
    // path param survives alongside the resolved query fields
    expect(byName.websiteId).toMatchObject({ location: 'path' })
    expect(byName.startAt).toMatchObject({ location: 'query', type: 'number', required: true })
    expect(byName.endAt).toMatchObject({ location: 'query', type: 'number', required: true })
    expect(byName.compare).toMatchObject({ location: 'query', type: 'string', required: false })
    expect(get!.evidence.some((e) => /schema via wrapper call parseRequest/.test(e))).toBe(true)
  })

  it('resolves an inline z.object passed to a POST wrapper as body fields', async () => {
    const ir = await compile('tests/fixtures/wrapper-shop')
    const post = ir.actions.find((a) => a.name === 'post_websites')
    expect(post).toBeDefined()
    const byName = Object.fromEntries(post!.inputs.map((i) => [i.name, i]))
    expect(byName.name).toMatchObject({ location: 'body', type: 'string', required: true })
    expect(byName.domain).toMatchObject({ location: 'body', type: 'string', required: true })
    expect(post!.evidence.some((e) => /schema via wrapper call parseRequest/.test(e))).toBe(true)
  })
})
