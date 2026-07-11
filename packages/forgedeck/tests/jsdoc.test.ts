import { describe, it, expect } from 'vitest'
import { Project, type JSDocableNode, type Node } from 'ts-morph'
import { readAgentDoc } from '../src/extract/jsdoc'

// Wrap a JSDoc block onto a trivial function declaration and hand the reader the
// declaration node. Fixtures are in-memory so each case is a self-contained grammar
// probe; wiring into real extractors is Task 3.
function docFor(jsdoc: string): JSDocableNode & Node {
  const project = new Project({ useInMemoryFileSystem: true })
  const sf = project.createSourceFile('/f.ts', `${jsdoc}\nexport function handler() {}\n`, {
    overwrite: true,
  })
  return sf.getFunctionOrThrow('handler')
}

describe('readAgentDoc', () => {
  it('returns an empty AgentDoc when there is no JSDoc', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const sf = project.createSourceFile('/n.ts', 'export function handler() {}\n')
    const doc = readAgentDoc(sf.getFunctionOrThrow('handler'))
    expect(doc).toEqual({
      preconditions: [],
      ignore: false,
      workflowSteps: [],
      malformed: [],
    })
  })

  it('parses @agent description', () => {
    const doc = readAgentDoc(
      docFor('/**\n * @agent description Returns the current cart total.\n */'),
    )
    expect(doc.description).toBe('Returns the current cart total.')
    expect(doc.malformed).toEqual([])
  })

  it('parses @agent effect for each legal value', () => {
    expect(readAgentDoc(docFor('/**\n * @agent effect read\n */')).effect).toBe('read')
    expect(readAgentDoc(docFor('/**\n * @agent effect write\n */')).effect).toBe('write')
    expect(readAgentDoc(docFor('/**\n * @agent effect irreversible\n */')).effect).toBe(
      'irreversible',
    )
  })

  it('parses @agent precondition', () => {
    const doc = readAgentDoc(
      docFor('/**\n * @agent precondition account must be in good standing\n */'),
    )
    expect(doc.preconditions).toEqual(['account must be in good standing'])
  })

  it('parses @agent auth for each legal value', () => {
    expect(readAgentDoc(docFor('/**\n * @agent auth none\n */')).auth).toBe('none')
    expect(readAgentDoc(docFor('/**\n * @agent auth required\n */')).auth).toBe('required')
  })

  it('parses @agent ignore', () => {
    expect(readAgentDoc(docFor('/**\n * @agent ignore\n */')).ignore).toBe(true)
  })

  it('parses @agent workflow with a step number', () => {
    const doc = readAgentDoc(docFor('/**\n * @agent workflow setup step 1\n */'))
    expect(doc.workflowSteps).toEqual([{ workflow: 'setup', step: 1 }])
  })

  it('parses @agent workflow with a requires clause', () => {
    const doc = readAgentDoc(
      docFor('/**\n * @agent workflow checkout step 2 requires a populated cart\n */'),
    )
    expect(doc.workflowSteps).toEqual([
      { workflow: 'checkout', step: 2, requires: 'a populated cart' },
    ])
  })

  it('harvests the summary as the description text above the first tag', () => {
    const doc = readAgentDoc(
      docFor(
        '/**\n * Charges the saved card and records the ledger entry.\n * @agent effect irreversible\n */',
      ),
    )
    expect(doc.summary).toBe('Charges the saved card and records the ledger entry.')
    expect(doc.effect).toBe('irreversible')
  })

  it('harvests only the first paragraph of the summary', () => {
    const doc = readAgentDoc(
      docFor(
        '/**\n * First paragraph is the summary.\n *\n * Second paragraph leaks internals and must not be harvested.\n */',
      ),
    )
    expect(doc.summary).toBe('First paragraph is the summary.')
  })

  it('has no summary when the block is tags only', () => {
    const doc = readAgentDoc(docFor('/**\n * @agent effect read\n */'))
    expect(doc.summary).toBeUndefined()
  })

  it('collects an unknown subcommand verbatim into malformed, never guessed', () => {
    const doc = readAgentDoc(docFor('/**\n * @agent destroy everything\n */'))
    expect(doc.malformed).toEqual(['@agent destroy everything'])
    expect(doc.effect).toBeUndefined()
    expect(doc.ignore).toBe(false)
  })

  it('collects a bad effect value as malformed', () => {
    const doc = readAgentDoc(docFor('/**\n * @agent effect maybe\n */'))
    expect(doc.malformed).toEqual(['@agent effect maybe'])
    expect(doc.effect).toBeUndefined()
  })

  it('collects a workflow tag missing its step number as malformed', () => {
    const doc = readAgentDoc(docFor('/**\n * @agent workflow checkout\n */'))
    expect(doc.malformed).toEqual(['@agent workflow checkout'])
    expect(doc.workflowSteps).toEqual([])
  })

  it('accumulates multiple preconditions', () => {
    const doc = readAgentDoc(
      docFor(
        '/**\n * @agent precondition must be signed in\n * @agent precondition cart must not be empty\n */',
      ),
    )
    expect(doc.preconditions).toEqual(['must be signed in', 'cart must not be empty'])
  })

  it('accumulates multiple workflow steps', () => {
    const doc = readAgentDoc(
      docFor(
        '/**\n * @agent workflow setup step 1\n * @agent workflow setup step 2 requires the profile exists\n */',
      ),
    )
    expect(doc.workflowSteps).toEqual([
      { workflow: 'setup', step: 1 },
      { workflow: 'setup', step: 2, requires: 'the profile exists' },
    ])
  })

  it('uses the last JSDoc block attached to the declaration', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const sf = project.createSourceFile(
      '/m.ts',
      '/** @agent effect read */\n/** @agent effect write */\nexport function handler() {}\n',
    )
    expect(readAgentDoc(sf.getFunctionOrThrow('handler')).effect).toBe('write')
  })

  it('keeps valid sibling tags when one tag in the block is malformed', () => {
    const doc = readAgentDoc(
      docFor(
        '/**\n * @agent auth none\n * @agent effect sideways\n * @agent precondition must be an admin\n */',
      ),
    )
    expect(doc.auth).toBe('none')
    expect(doc.preconditions).toEqual(['must be an admin'])
    expect(doc.malformed).toEqual(['@agent effect sideways'])
  })
})
