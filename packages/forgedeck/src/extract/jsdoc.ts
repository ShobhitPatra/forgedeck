import type { JSDocableNode } from 'ts-morph'
import type { Effect } from '../ir/types.js'

// readAgentDoc is the single place the `@agent` annotation grammar lives. It reads
// ONE declaration's JSDoc block and returns everything it finds, verbatim; it makes
// no decisions about which action a tag applies to. That scoping is the extractor's
// job (Task 3), governed by the following ORCHESTRATOR RULING, encoded there:
//
//   On a declaration that yields MULTIPLE derived actions (e.g. a pages-router
//   handler branching on req.method):
//     - handler-level tags — description, auth, precondition, ignore — INHERIT to
//       every derived action (they describe the handler, not one verb);
//     - act-specific tags — effect, workflow — attach ONLY to the non-read derived
//       actions (a workflow step or an effect override is meaningless on a read);
//       when such a declaration has more than one non-read derived action the
//       extractor must emit a coverage warning, because a single act-specific tag
//       cannot unambiguously pick among several writes.
//
// The grammar is intentionally strict: a tag either matches the locked vocabulary
// exactly or its raw text is collected into `malformed` — never guessed at. That is
// the same never-lie-by-omission rule the contracts follow: a human typo becomes a
// visible coverage warning ('malformed @agent tag: <raw>'), never a silent misread.
//
// Locked vocabulary (spec grill):
//   @agent description <text>
//   @agent effect read|write|irreversible
//   @agent precondition <text>
//   @agent auth none|required
//   @agent ignore
//   @agent workflow <name> step <n> [requires <text>]

export interface WorkflowStep {
  workflow: string
  step: number
  requires?: string
}

export interface AgentDoc {
  // Prose harvested from the JSDoc description block (first paragraph, above any
  // tag). Distinct from `description`, which is only ever an explicit @agent tag.
  summary?: string
  description?: string
  effect?: Effect
  preconditions: string[]
  auth?: 'none' | 'required'
  ignore: boolean
  workflowSteps: WorkflowStep[]
  // Raw `@agent ...` text of every tag that did not match the vocabulary, kept
  // verbatim so a reviewer sees exactly what was typed.
  malformed: string[]
}

const EFFECTS: ReadonlySet<string> = new Set<Effect>(['read', 'write', 'irreversible'])

// `<name> step <n>` with an optional trailing `requires <text>`. The name is a
// single non-space token; the step must be one or more digits; requires captures
// the remainder. Anything else (e.g. a missing step number) fails the match and the
// tag is treated as malformed.
const WORKFLOW = /^(\S+)\s+step\s+(\d+)(?:\s+requires\s+(.+))?$/

// Split the first word (the subcommand) off the rest of a tag payload.
function splitHead(payload: string): { head: string; rest: string } {
  const m = /^(\S+)\s*([\s\S]*)$/.exec(payload)
  if (!m) return { head: '', rest: '' }
  return { head: m[1], rest: m[2].trim() }
}

// Reduce a harvested summary to its first paragraph: paragraphs are separated by a
// blank line, and soft-wrapped lines within a paragraph collapse to single spaces.
function firstParagraph(description: string): string | undefined {
  const trimmed = description.trim()
  if (!trimmed) return undefined
  const para = trimmed.split(/\n[ \t]*\n/)[0]
  const collapsed = para.replace(/\s+/g, ' ').trim()
  return collapsed || undefined
}

// Read the `@agent` annotations and summary from a declaration's JSDoc. When the
// declaration has several JSDoc blocks the LAST one wins (it is the block that sits
// immediately above the declaration). A declaration with no JSDoc yields an empty
// AgentDoc: no tags, no summary, nothing malformed.
// True when a declaration's JSDoc carries ANY human signal — a harvested summary or
// an `@agent` tag of any kind, including a malformed one. Used to decide whether a
// human deliberately annotated an otherwise auto-excluded route (e.g. auth plumbing):
// human facts win over the heuristic, so an annotated plumbing route is surfaced.
export function hasAgentAnnotations(doc: AgentDoc): boolean {
  return (
    doc.summary !== undefined ||
    doc.description !== undefined ||
    doc.effect !== undefined ||
    doc.auth !== undefined ||
    doc.ignore ||
    doc.preconditions.length > 0 ||
    doc.workflowSteps.length > 0 ||
    doc.malformed.length > 0
  )
}

export function readAgentDoc(node: JSDocableNode): AgentDoc {
  const doc: AgentDoc = {
    preconditions: [],
    ignore: false,
    workflowSteps: [],
    malformed: [],
  }

  const blocks = node.getJsDocs()
  if (blocks.length === 0) return doc
  const block = blocks[blocks.length - 1]

  doc.summary = firstParagraph(block.getDescription())

  for (const tag of block.getTags()) {
    if (tag.getTagName() !== 'agent') continue
    const payload = (tag.getCommentText() ?? '').trim()
    const raw = `@agent ${payload}`.trimEnd()
    const { head, rest } = splitHead(payload)

    switch (head) {
      case 'description':
        if (rest) doc.description = rest
        else doc.malformed.push(raw)
        break
      case 'effect':
        if (EFFECTS.has(rest)) doc.effect = rest as Effect
        else doc.malformed.push(raw)
        break
      case 'precondition':
        if (rest) doc.preconditions.push(rest)
        else doc.malformed.push(raw)
        break
      case 'auth':
        if (rest === 'none' || rest === 'required') doc.auth = rest
        else doc.malformed.push(raw)
        break
      case 'ignore':
        // Presence is the whole signal; honour the exclusion intent even if a
        // stray word trails it, so a debug route is never accidentally kept.
        doc.ignore = true
        break
      case 'workflow': {
        const m = WORKFLOW.exec(rest)
        if (m) {
          const step: WorkflowStep = { workflow: m[1], step: Number(m[2]) }
          if (m[3]) step.requires = m[3].trim()
          doc.workflowSteps.push(step)
        } else {
          doc.malformed.push(raw)
        }
        break
      }
      default:
        doc.malformed.push(raw)
    }
  }

  return doc
}
