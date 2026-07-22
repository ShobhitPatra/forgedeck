import { describe, it, expect } from 'vitest'
import { compile } from '../src/compile'
import { toToolsManifest } from '../src/emit/tools'

describe('derived description enrichment', () => {
  it('appends effect, auth and param summary to derived descriptions', async () => {
    const ir = await compile('tests/fixtures/mini-shop')
    const manifest = toToolsManifest(ir)
    const stats = manifest.tools.find((t) => t.name === 'get_stats')
    expect(stats!.description).toMatch(/read/)
    expect(stats!.description).toMatch(/query: endAt, startAt, unit|query: startAt, endAt, unit/)
  })
  it('leaves authored descriptions untouched', async () => {
    const ir = await compile('tests/fixtures/mini-shop')
    const authored = ir.actions.find((a) =>
      a.evidence.some((e) => e.includes('description via @agent tag')),
    )
    if (authored) {
      const manifest = toToolsManifest(ir)
      const t = manifest.tools.find((x) => x.name === authored.name)
      expect(t!.description.startsWith(authored.description)).toBe(true)
    }
  })
})
