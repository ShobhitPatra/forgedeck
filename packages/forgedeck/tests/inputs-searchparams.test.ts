import { describe, it, expect } from 'vitest'
import { compile } from '../src/compile'
import { toToolsManifest } from '../src/emit/tools'

describe('searchParams.get query extraction', () => {
  it('emits query InputFields for searchParams.get calls', async () => {
    const ir = await compile('tests/fixtures/mini-shop')
    const stats = ir.actions.find((a) => a.name === 'get_stats')
    expect(stats).toBeDefined()
    const queryInputs = stats!.inputs.filter((i) => i.location === 'query')
    expect(queryInputs.map((i) => i.name).sort()).toEqual(['endAt', 'startAt', 'unit'])
    for (const q of queryInputs) {
      expect(q.required).toBe(false)
      expect(q.type).toBe('string')
    }
    expect(stats!.evidence.some((e) => /searchParams/.test(e))).toBe(true)

    const manifest = toToolsManifest(ir)
    const tool = manifest.tools.find((t) => t.name === 'get_stats')!
    expect(tool.inputSchema.properties.startAt).toBeDefined()
    expect(tool.inputSchema.required).not.toContain('startAt')
  })
})
