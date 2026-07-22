import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile } from '../src/compile'
import { emitBundle } from '../src/emit/bundle'
import { renderCoverage } from '../src/emit/coverage'
import type { SemanticIR } from '../src/ir/types'

describe('emitBundle', () => {
  const out = mkdtempSync(join(tmpdir(), 'forgedeck-'))
  let ir: SemanticIR
  let written: string[]
  beforeAll(async () => {
    ir = await compile('tests/fixtures/mini-shop')
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
    expect(idx).toContain('5 actions')
  })
  it('coverage report renders', () => {
    const report = renderCoverage(ir)
    expect(report).toContain('5 actions extracted')
    expect(report).toContain('0 skipped')
  })

  it('emits no annotation-only artefacts for an un-annotated app', () => {
    // no workflows -> no workflows/ files, no index link, no HARVESTED receipts
    expect(written.some((f) => f.startsWith('workflows/'))).toBe(false)
    expect(readFileSync(join(out, 'index.md'), 'utf8')).not.toContain('workflows/')
    expect(renderCoverage(ir)).not.toContain('HARVESTED')
    // no preconditions -> no Preconditions section on any action md
    for (const a of ir.actions) {
      const md = readFileSync(join(out, `actions/${a.name}.md`), 'utf8')
      expect(md).not.toContain('## Preconditions')
    }
  })
})

describe('emitBundle auth and evidence (hybrid-shop)', () => {
  const out = mkdtempSync(join(tmpdir(), 'forgedeck-hs-'))
  let ir: SemanticIR
  beforeAll(async () => {
    ir = await compile('tests/fixtures/hybrid-shop')
    emitBundle(ir, out)
  })

  it('put_settings markdown carries auth frontmatter and an Evidence section', () => {
    const md = readFileSync(join(out, 'actions/put_settings.md'), 'utf8')
    expect(md).toContain('auth: required')
    expect(md).toContain('## Evidence')
  })

  it('coverage renders an auth histogram line', () => {
    const report = renderCoverage(ir)
    expect(report).toMatch(/auth: \d+ required, \d+ unknown, \d+ none/)
  })

  it('delete_survey markdown carries a Preconditions section', () => {
    const md = readFileSync(join(out, 'actions/delete_survey.md'), 'utf8')
    expect(md).toContain('## Preconditions')
    expect(md).toContain('- account must be in good standing')
  })

  it('emits an ordered workflow file the index links to', () => {
    const wf = readFileSync(join(out, 'workflows/setup.md'), 'utf8')
    expect(existsSync(join(out, 'workflows/setup.md'))).toBe(true)
    // frontmatter carries the name and step count
    expect(wf).toContain('name: setup')
    expect(wf).toContain('steps: 2')
    // two ordered steps, in sequence, no requires clause on either
    expect(wf).toContain('1. post_documents')
    expect(wf).toContain('2. put_settings')
    expect(wf).not.toMatch(/requires:/)
    const idx = readFileSync(join(out, 'index.md'), 'utf8')
    expect(idx).toContain('[setup](workflows/setup.md)')
  })

  it('coverage prints a HARVESTED receipt for the harvested summary, leak stripped', () => {
    const report = renderCoverage(ir)
    expect(report).toContain(
      'HARVESTED post_billing: "Charges the customer\'s saved payment method and records the ledger entry."',
    )
    // the trailing note after the @internal marker must never surface in the receipt
    expect(report).not.toMatch(/internal|trailing note/i)
    // the annotation-resolved auth value is counted: get_health is the lone none
    expect(report).toMatch(/auth: \d+ required, \d+ unknown, 1 none/)
  })
})
