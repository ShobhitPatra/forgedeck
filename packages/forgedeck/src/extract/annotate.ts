import type { Node, JSDocableNode } from 'ts-morph'
import type { ActionIR, CoverageItem, Effect, WorkflowIR } from '../ir/types.js'
import type { AgentDoc } from './jsdoc.js'

// Where the human channel joins the derived facts. `readAgentDoc` (Task 2) reports
// what a declaration's JSDoc says; this module decides what that means for the
// action(s) the declaration produces, under one fixed precedence and two safety
// rules so humans may RESTRICT or FILL ABSENCE but never CONTRADICT static evidence:
//
//   description : tag > harvested summary > derived     (precedence)
//   effect      : may only escalate (read<write<irreversible); a relaxation to
//                 `read` is honoured ONLY when the derived write was the conservative
//                 default with no write evidence — otherwise refused with a warning
//   auth        : resolves `unknown` only; code-detected `required` beats a human
//                 `none` (a conflict warning, never a silent downgrade)
//   precondition: attached verbatim (inherits to every derived action of a handler)
//
// Every override leaves a receipt in `evidence`, and every refusal/malformed tag a
// coverage warning, so the bundle stays auditable.

const EFFECT_RANK: Record<Effect, number> = { read: 0, write: 1, irreversible: 2 }

// A workflow step still bound to its ActionIR by reference — the action's final
// name is not known until collision resolution runs, so compile reads it late.
export interface WorkflowBinding {
  action: ActionIR
  workflow: string
  step: number
  requires?: string
}

// Climb from a resolved handler/action node to the nearest ancestor that actually
// carries a JSDoc block (a const handler's JSDoc lives on its VariableStatement, not
// the arrow), falling back to the first JSDoc-able node so `readAgentDoc` still runs.
export function jsdocHostOf(node: Node): JSDocableNode {
  let cur: Node | undefined = node
  let firstDocable: JSDocableNode | undefined
  while (cur) {
    const maybe = cur as unknown as { getJsDocs?: () => { length: number }[] }
    if (typeof maybe.getJsDocs === 'function') {
      const docable = cur as unknown as JSDocableNode
      if (!firstDocable) firstDocable = docable
      if (docable.getJsDocs().length > 0) return docable
    }
    cur = cur.getParent()
  }
  return firstDocable ?? (node as unknown as JSDocableNode)
}

// Apply the `@agent` semantics to one freshly constructed ActionIR. Mutates
// `action` in place (description, effect, enabled, auth, preconditions, evidence)
// and returns coverage warnings plus workflow-step bindings for the compile stage.
//
// `actSpecific` gates the act-specific tags (effect, workflow): true for a
// single-action declaration and for the NON-READ arms of a multi-action handler;
// false for a read arm (an effect override or workflow step is meaningless on a
// read). Handler-level tags (description, auth, precondition) always apply.
export function applyAgentDoc(
  action: ActionIR,
  doc: AgentDoc,
  ctx: { file: string; actSpecific: boolean },
): { warnings: CoverageItem[]; workflowBindings: WorkflowBinding[] } {
  const warnings: CoverageItem[] = []
  const workflowBindings: WorkflowBinding[] = []
  const { file } = ctx

  for (const raw of doc.malformed) warnings.push({ file, reason: `malformed @agent tag: ${raw}` })

  // description: tag > harvested summary > derived
  if (doc.description) {
    action.description = doc.description
    action.evidence.push('description via @agent tag')
  } else if (doc.summary) {
    action.description = doc.summary
    action.evidence.push('description harvested from jsdoc')
  }

  // preconditions inherit to every derived action of the handler
  for (const p of doc.preconditions) {
    action.preconditions.push(p)
    action.evidence.push(`precondition via @agent tag: ${p}`)
  }

  // auth resolves `unknown` only; code-detected `required` beats a human `none`
  if (doc.auth) {
    if (action.auth === 'unknown') {
      action.auth = doc.auth
      action.evidence.push(`auth ${doc.auth} via @agent tag`)
      if (doc.auth === 'none') warnings.push({ file, reason: 'auth none by annotation' })
    } else if (action.auth === 'required' && doc.auth === 'none') {
      warnings.push({
        file,
        reason: '@agent auth none conflicts with detected required auth, kept required',
      })
    }
  }

  // effect override (act-specific): escalate freely; relax to read only from the
  // conservative default (no write evidence in the derived trail).
  if (doc.effect && ctx.actSpecific) {
    const derived = action.effect
    const want = EFFECT_RANK[doc.effect]
    const have = EFFECT_RANK[derived]
    if (want > have) {
      action.effect = doc.effect
      action.enabled = doc.effect === 'read'
      action.evidence.push(`effect ${doc.effect} via @agent tag (escalation from ${derived})`)
    } else if (want === have) {
      action.evidence.push(`effect ${doc.effect} via @agent tag`)
    } else if (
      derived === 'write' &&
      doc.effect === 'read' &&
      !action.evidence.some((e) => e.startsWith('effect write via '))
    ) {
      action.effect = 'read'
      action.enabled = true
      action.evidence.push('effect read via @agent tag (annotated absence of write evidence)')
    } else {
      warnings.push({
        file,
        reason: '@agent effect read conflicts with derived write evidence, kept write',
      })
    }
  }

  // workflow steps (act-specific)
  if (ctx.actSpecific) {
    for (const s of doc.workflowSteps) {
      const binding: WorkflowBinding = { action, workflow: s.workflow, step: s.step }
      if (s.requires !== undefined) binding.requires = s.requires
      workflowBindings.push(binding)
      action.evidence.push(`workflow ${s.workflow} step ${s.step} via @agent tag`)
    }
  }

  return { warnings, workflowBindings }
}

// Assemble SemanticIR.workflows from every collected binding. Steps are grouped by
// workflow name, sorted by step number, and their `action` resolved from the (now
// collision-renamed) ActionIR reference. Gaps and duplicates in a workflow's step
// sequence surface as coverage warnings; nothing is dropped.
export function assembleWorkflows(bindings: WorkflowBinding[]): {
  workflows: WorkflowIR[]
  warnings: CoverageItem[]
} {
  const warnings: CoverageItem[] = []
  const groups = new Map<string, WorkflowBinding[]>()
  for (const b of bindings) {
    const g = groups.get(b.workflow)
    if (g) g.push(b)
    else groups.set(b.workflow, [b])
  }

  const workflows: WorkflowIR[] = []
  for (const name of [...groups.keys()].sort()) {
    const steps = [...groups.get(name)!].sort((a, b) => a.step - b.step)
    const seen = new Set<number>()
    for (const s of steps) {
      if (seen.has(s.step))
        warnings.push({
          file: s.action.sourceFile,
          reason: `workflow ${name} step sequence warning: duplicate step ${s.step}`,
        })
      seen.add(s.step)
    }
    const max = steps[steps.length - 1].step
    for (let n = 1; n <= max; n++) {
      if (!seen.has(n))
        warnings.push({
          file: steps[0].action.sourceFile,
          reason: `workflow ${name} step sequence warning: missing step ${n}`,
        })
    }
    workflows.push({
      name,
      steps: steps.map((s) => {
        const out: WorkflowIR['steps'][number] = { step: s.step, action: s.action.name }
        if (s.requires !== undefined) out.requires = s.requires
        return out
      }),
    })
  }
  return { workflows, warnings }
}
