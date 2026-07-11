import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile } from '../src/compile'
import { emitBundle } from '../src/emit/bundle'
import { renderCoverage } from '../src/emit/coverage'

describe('emitBundle', () => {
  const out = mkdtempSync(join(tmpdir(), 'forgedeck-'))
  const ir = compile('tests/fixtures/mini-shop')
  let written: string[]
  beforeAll(() => {
    written = emitBundle(ir, out)
  })

  it('writes the expected file tree', () => {
    for (const f of [
      'index.md',
      'tools.json',
      'ir.json',
      'entities/product.md',
      'actions/get_products.md',
      'actions/add_to_cart.md',
    ]) {
      expect(written).toContain(f)
      expect(existsSync(join(out, f))).toBe(true)
    }
  })
  it('action markdown carries frontmatter with effect and enabled', () => {
    const md = readFileSync(join(out, 'actions/post_orders.md'), 'utf8')
    expect(md).toContain('effect: write')
    expect(md).toContain('enabled: false')
    expect(md).toContain('POST /api/orders')
  })
  it('index lists counts', () => {
    const idx = readFileSync(join(out, 'index.md'), 'utf8')
    expect(idx).toContain('mini-shop')
    expect(idx).toContain('3 entities')
    expect(idx).toContain('4 actions')
  })
  it('coverage report renders', () => {
    const report = renderCoverage(ir)
    expect(report).toContain('4 actions extracted')
    expect(report).toContain('0 skipped')
  })
})
