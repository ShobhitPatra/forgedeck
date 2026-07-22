import { describe, it, expect } from 'vitest'
import { compile } from '../src/compile'
import { renderCoverage } from '../src/emit/coverage'

describe('scope verdict', () => {
  it('mini-shop is IN scope', async () => {
    const ir = await compile('tests/fixtures/mini-shop')
    expect(ir.coverage.verdict.status).toBe('in')
    expect(ir.coverage.verdict.extractedRatio).toBeGreaterThanOrEqual(0.8)
  })
  it('renders a SCOPE line in coverage.txt', async () => {
    const ir = await compile('tests/fixtures/mini-shop')
    const text = renderCoverage(ir)
    expect(text).toMatch(/^SCOPE: IN \(\d+% of surface extracted\)/m)
  })
  it('a trpc-shaped app goes OUT of scope', async () => {
    const ir = await compile('tests/fixtures/trpc-shop')
    expect(ir.coverage.verdict.status).toBe('out')
    expect(ir.coverage.verdict.dominantSkipReasons[0]).toBe('trpc')
    const text = renderCoverage(ir)
    expect(text).toMatch(/^SCOPE: OUT/m)
  })
})
