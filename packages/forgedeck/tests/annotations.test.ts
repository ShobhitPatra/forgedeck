import { describe, it, expect } from 'vitest'
import { compile } from '../src/compile'
import type { SemanticIR } from '../src/ir/types'

// Task 3 integration: each case asserts the DELTA the annotation semantics apply on
// top of the PR #42 derived baselines. The baselines (description/effect/auth per
// action) are the documented contract; here we prove every override, harvest,
// exclusion and workflow lands with its receipt — humans restrict or fill absence,
// never contradict static evidence, and every change is auditable.

describe('annotation semantics on hybrid-shop', () => {
  const ir: SemanticIR = compile('tests/fixtures/hybrid-shop')
  const byName = (n: string) => ir.actions.find((a) => a.name === n)
  const reasons = ir.coverage.skipped.map((s) => s.reason)

  it('delete_survey escalates write -> irreversible, stays disabled, with precondition + receipts', () => {
    const a = byName('delete_survey')!
    // baseline: effect write (from prisma.document.delete), auth required
    expect(a.effect).toBe('irreversible')
    expect(a.enabled).toBe(false)
    expect(a.preconditions).toEqual(['account must be in good standing'])
    expect(a.evidence).toContain('effect write via prisma.document.delete') // evidence preserved
    expect(a.evidence).toContain('effect irreversible via @agent tag (escalation from write)')
    expect(a.evidence).toContain('precondition via @agent tag: account must be in good standing')
  })

  it('get_health resolves unknown -> none via @agent auth, flagged in coverage', () => {
    const a = byName('get_health')!
    // baseline: auth unknown
    expect(a.auth).toBe('none')
    expect(a.evidence).toContain('auth none via @agent tag')
    expect(reasons).toContain('auth none by annotation')
  })

  it('get_stats description is overridden by the @agent description tag', () => {
    const a = byName('get_stats')!
    // baseline: description "GET /api/stats"
    expect(a.description).toBe('Returns aggregate document counts for the analytics dashboard.')
    expect(a.evidence).toContain('description via @agent tag')
  })

  it('post_documents carries workflow setup step 1; its sibling read get_documents does NOT', () => {
    const post = byName('post_documents')!
    const get = byName('get_documents')!
    // both derive from ONE handler declaration; act-specific tags attach to the
    // non-read arm only (orchestrator ruling)
    expect(post.evidence).toContain('workflow setup step 1 via @agent tag')
    expect(get.evidence.some((e) => /workflow/.test(e))).toBe(false)
    expect(get.description).toBe('GET /api/documents') // untouched read arm
  })

  it('put_settings carries workflow setup step 2', () => {
    const a = byName('put_settings')!
    expect(a.evidence).toContain('workflow setup step 2 via @agent tag')
  })

  it('assembles the setup workflow with two ordered steps and no requires clause', () => {
    expect(ir.workflows).toEqual([
      {
        name: 'setup',
        steps: [
          { step: 1, action: 'post_documents' },
          { step: 2, action: 'put_settings' },
        ],
      },
    ])
    // requires is OMITTED when absent (matches the reader's WorkflowStep shape)
    for (const s of ir.workflows[0].steps) expect('requires' in s).toBe(false)
  })

  it('get_debug is excluded by @agent ignore with a skip-log and emits no action', () => {
    expect(byName('get_debug')).toBeUndefined()
    expect(ir.actions.some((a) => a.sourceFile === 'pages/api/debug.ts')).toBe(false)
    expect(ir.coverage.skipped).toContainEqual({
      file: 'pages/api/debug.ts',
      reason: 'excluded by @agent ignore',
    })
  })

  it('post_billing harvests the summary and stops at the @internal leak marker', () => {
    const a = byName('post_billing')!
    // baseline: description "POST /api/billing"; harvest lifts the first paragraph
    expect(a.description).toBe(
      "Charges the customer's saved payment method and records the ledger entry.",
    )
    expect(a.evidence).toContain('description harvested from jsdoc')
    // the trailing note after the @internal tag must NOT leak into the description
    expect(a.description).not.toMatch(/internal|trailing note/i)
  })

  it('get_files_by_path and post_views harvest their plain summaries', () => {
    const files = byName('get_files_by_path')!
    expect(files.description).toBe('Streams a stored file to the caller by its storage path.')
    expect(files.evidence).toContain('description harvested from jsdoc')

    const views = byName('post_views')!
    expect(views.description).toBe('Records that the current user viewed a document.')
    expect(views.evidence).toContain('description harvested from jsdoc')
  })
})

describe('annotations leave un-annotated apps untouched (mini-shop frozen)', () => {
  const mini: SemanticIR = compile('tests/fixtures/mini-shop')

  it('has no workflows and no preconditions and no annotation coverage notes', () => {
    expect(mini.workflows).toEqual([])
    for (const a of mini.actions) expect(a.preconditions).toEqual([])
    expect(mini.coverage.skipped).toEqual([])
    for (const a of mini.actions) {
      expect(a.evidence.some((e) => /@agent|harvested from jsdoc/.test(e))).toBe(false)
    }
  })

  it('keeps the four derived actions with their derived descriptions', () => {
    expect(mini.actions.map((a) => a.name).sort()).toEqual([
      'add_to_cart',
      'get_products',
      'get_products_by_id',
      'post_orders',
    ])
    // derived descriptions are unchanged (no JSDoc carrier to harvest or override)
    expect(mini.actions.find((a) => a.name === 'get_products')!.description).toBe(
      'GET /api/products',
    )
  })
})
