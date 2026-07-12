import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { diffIR, renderDiffMarkdown, isEmptyDiff, runDiff } from '../src/diff'
import type { ActionIR, InputField, SemanticIR } from '../src/ir/types'

// Minimal, structurally-valid action for synthetic IR pairs. Every field the
// diff reads is overridable; the defaults describe the safest possible action
// (an enabled read, no auth, no inputs) so a test names only what it changes.
function act(over: Partial<ActionIR> & { name: string }): ActionIR {
  return {
    kind: 'route',
    sourceFile: `app/api/${over.name}/route.ts`,
    exportName: 'GET',
    description: '',
    inputs: [],
    effect: 'read',
    entitiesTouched: [],
    enabled: true,
    enabledBy: 'read-default',
    confidence: 'static',
    auth: 'none',
    preconditions: [],
    evidence: [],
    ...over,
  }
}

function ir(actions: ActionIR[]): SemanticIR {
  return {
    app: { name: 'x', framework: 'nextjs-app-router' },
    entities: [],
    actions,
    workflows: [],
    coverage: { extracted: actions.length, skipped: [] },
  }
}

function input(over: Partial<InputField> & { name: string }): InputField {
  return { type: 'string', required: true, location: 'body', ...over }
}

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

describe('diffIR — change classes', () => {
  it('detects added and removed actions', () => {
    const base = ir([act({ name: 'get_a' })])
    const head = ir([act({ name: 'get_b' })])
    const d = diffIR(base, head)
    expect(d.actionsAdded.map((a) => a.name)).toEqual(['get_b'])
    expect(d.actionsRemoved.map((a) => a.name)).toEqual(['get_a'])
    expect(d.actionsChanged).toEqual([])
  })

  it('flags an effect escalation read -> write as HIGH', () => {
    const base = ir([act({ name: 'do_thing', effect: 'read' })])
    const head = ir([act({ name: 'do_thing', effect: 'write' })])
    const d = diffIR(base, head)
    const c = d.actionsChanged[0]
    expect(c.effect).toEqual({ from: 'read', to: 'write', escalation: true })
    const md = renderDiffMarkdown(d)
    expect(md).toMatch(/read . write|read -> write|read → write/)
  })

  it('flags read -> irreversible as an escalation', () => {
    const d = diffIR(
      ir([act({ name: 'wipe', effect: 'read' })]),
      ir([act({ name: 'wipe', effect: 'irreversible' })]),
    )
    expect(d.actionsChanged[0].effect?.escalation).toBe(true)
  })

  it('does not flag a de-escalation write -> read as an escalation', () => {
    const d = diffIR(
      ir([act({ name: 'thing', effect: 'write' })]),
      ir([act({ name: 'thing', effect: 'read' })]),
    )
    expect(d.actionsChanged[0].effect?.escalation).toBe(false)
  })

  it('detects a newly required input', () => {
    const base = ir([act({ name: 'create', inputs: [] })])
    const head = ir([act({ name: 'create', inputs: [input({ name: 'total' })] })])
    const d = diffIR(base, head)
    expect(d.actionsChanged[0].requiredInputsAdded.map((i) => i.name)).toEqual(['total'])
  })

  it('treats an optional field becoming required as a newly required input', () => {
    const base = ir([act({ name: 'create', inputs: [input({ name: 'note', required: false })] })])
    const head = ir([act({ name: 'create', inputs: [input({ name: 'note', required: true })] })])
    const d = diffIR(base, head)
    expect(d.actionsChanged[0].requiredInputsAdded.map((i) => i.name)).toEqual(['note'])
  })

  it('separates optional-input additions from required ones', () => {
    const head = ir([act({ name: 'create', inputs: [input({ name: 'memo', required: false })] })])
    const d = diffIR(ir([act({ name: 'create' })]), head)
    expect(d.actionsChanged[0].requiredInputsAdded).toEqual([])
    expect(d.actionsChanged[0].optionalInputsAdded.map((i) => i.name)).toEqual(['memo'])
  })

  it('detects a removed required input', () => {
    const base = ir([act({ name: 'create', inputs: [input({ name: 'total' })] })])
    const d = diffIR(base, ir([act({ name: 'create' })]))
    expect(d.actionsChanged[0].requiredInputsRemoved.map((i) => i.name)).toEqual(['total'])
  })

  it('detects auth loosening required -> none', () => {
    const d = diffIR(
      ir([act({ name: 'read_it', auth: 'required' })]),
      ir([act({ name: 'read_it', auth: 'none' })]),
    )
    expect(d.actionsChanged[0].auth).toEqual({ from: 'required', to: 'none' })
  })

  it('detects entities touched added and removed', () => {
    const d = diffIR(
      ir([act({ name: 'x', entitiesTouched: ['User'] })]),
      ir([act({ name: 'x', entitiesTouched: ['Order'] })]),
    )
    expect(d.actionsChanged[0].entitiesAdded).toEqual(['Order'])
    expect(d.actionsChanged[0].entitiesRemoved).toEqual(['User'])
  })

  it('detects a description change (LOW)', () => {
    const d = diffIR(
      ir([act({ name: 'x', description: 'old' })]),
      ir([act({ name: 'x', description: 'new' })]),
    )
    expect(d.actionsChanged[0].descriptionChanged).toEqual({ from: 'old', to: 'new' })
  })
})

describe('renderDiffMarkdown — severity ordering & folding', () => {
  it('empty diff renders the empty string', () => {
    const d = diffIR(ir([act({ name: 'x' })]), ir([act({ name: 'x' })]))
    expect(isEmptyDiff(d)).toBe(true)
    expect(renderDiffMarkdown(d)).toBe('')
  })

  it('orders HIGH before MEDIUM before the folded LOW <details>', () => {
    const base = ir([
      act({ name: 'buy', effect: 'read', auth: 'none', description: 'old' }),
      act({ name: 'peek', auth: 'none' }),
    ])
    const head = ir([
      // HIGH: effect escalation. LOW: description change (same action).
      act({ name: 'buy', effect: 'write', auth: 'none', description: 'new' }),
      // MEDIUM: auth tightened.
      act({ name: 'peek', auth: 'required' }),
    ])
    const md = renderDiffMarkdown(diffIR(base, head))
    const hi = md.indexOf('read')
    const details = md.indexOf('<details>')
    expect(hi).toBeGreaterThanOrEqual(0)
    expect(details).toBeGreaterThan(0)
    // The description change (LOW) is inside the folded block, after <details>.
    expect(md.indexOf('description')).toBeGreaterThan(details)
    // A high-severity heading/marker precedes the folded block.
    expect(hi).toBeLessThan(details)
  })

  it('folds added actions (additive) under <details>', () => {
    const d = diffIR(ir([]), ir([act({ name: 'new_read' })]))
    const md = renderDiffMarkdown(d)
    expect(md).toContain('<details>')
    expect(md.indexOf('new_read')).toBeGreaterThan(md.indexOf('<details>'))
  })
})

describe('runDiff — integration', () => {
  it('hybrid-shop HEAD vs working tree is empty (fixture unchanged)', async () => {
    const dir = join(root, 'tests/fixtures/hybrid-shop')
    const { diff, markdown } = await runDiff('HEAD', dir)
    expect(isEmptyDiff(diff)).toBe(true)
    expect(markdown).toBe('')
  }, 60_000)
})

describe('cli — diff registration', () => {
  it('registers `forgedeck diff` with --base and --check', () => {
    const out = execFileSync('pnpm', ['exec', 'tsx', 'src/cli/index.ts', 'diff', '--help'], {
      encoding: 'utf8',
      cwd: root,
    })
    expect(out).toMatch(/--base/)
    expect(out).toMatch(/--check/)
    expect(out).toMatch(/--format/)
  })
})
