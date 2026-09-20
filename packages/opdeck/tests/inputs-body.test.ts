import { describe, it, expect } from 'vitest'
import { compile } from '../src/compile'

describe('body contract extraction', () => {
  it('extracts req.json destructure keys as body fields', async () => {
    const ir = await compile('tests/fixtures/mini-shop')
    const post = ir.actions.find((a) => a.name === 'post_widgets')
    expect(
      post!.inputs
        .filter((i) => i.location === 'body')
        .map((i) => i.name)
        .sort(),
    ).toEqual(['domain', 'name'])
  })
  it('resolves inline z.object literals passed to parse', async () => {
    const ir = await compile('tests/fixtures/mini-shop')
    const put = ir.actions.find((a) => a.name === 'put_widgets')
    const byName = Object.fromEntries(put!.inputs.map((i) => [i.name, i]))
    expect(byName.label.type).toBe('string')
    expect(byName.label.required).toBe(true)
    expect(byName.count.required).toBe(false)
  })

  it('binds the request-parsing schema, not an interior decoy schema', async () => {
    // POST /api/links parses the request with CreateLinkSchema AND separately
    // validates a derived watermark sub-object with WatermarkConfigSchema. The
    // tool must carry the request contract, never the decoy's fields.
    const ir = await compile('tests/fixtures/decoy-shop')
    const post = ir.actions.find((a) => a.name === 'post_links')
    expect(post).toBeDefined()
    const names = post!.inputs
      .filter((i) => i.location === 'body')
      .map((i) => i.name)
      .sort()
    expect(names).toEqual(['documentId', 'expiresAt', 'name', 'teamId'])
    // None of the decoy watermark fields leak in.
    for (const decoy of ['text', 'color', 'opacity']) {
      expect(names).not.toContain(decoy)
    }
  })
})
