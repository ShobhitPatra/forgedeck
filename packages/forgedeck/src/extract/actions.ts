import { Node, SyntaxKind, type JSDocableNode } from 'ts-morph'
import type { ActionIR, AuthRequirement, CoverageItem } from '../ir/types.js'
import type { LoadedProject } from '../load/project.js'
import { fnToName } from '../ir/names.js'
import { classifyEffect } from './effects.js'
import { extractInputs } from './inputs.js'
import { detectHandlerAuth, resolveAuth } from './auth.js'
import { asFnLike, resolveFn, terminalActionCall } from './unwrap.js'
import { readAgentDoc } from './jsdoc.js'
import { applyAgentDoc, type WorkflowBinding } from './annotate.js'

// A client root whose name announces authentication (`authenticatedActionClient`,
// `authorizedClient`, `protectedProcedure`, or anything containing `auth`) makes
// the action it wraps `required` (server actions contract rule 2).
const AUTH_ROOT = /^(authenticated|authorized|protected)/i

function rootImpliesAuth(root: string): boolean {
  return AUTH_ROOT.test(root) || /auth/i.test(root)
}

export function extractServerActions(loaded: LoadedProject): {
  actions: ActionIR[]
  skipped: CoverageItem[]
  workflowBindings: WorkflowBinding[]
} {
  const actions: ActionIR[] = []
  const skipped: CoverageItem[] = []
  const workflowBindings: WorkflowBinding[] = []

  for (const sf of loaded.project.getSourceFiles()) {
    const rel = loaded.relPath(sf.getFilePath())
    const first = sf.getStatements()[0]?.getText() ?? ''
    const isDirectiveFile = /^['"]use server['"];?$/.test(first)

    if (!isDirectiveFile) {
      // Function level directives are real server actions we cannot yet extract;
      // record them so coverage tells the truth (grill patch Q1)
      for (const fn of sf.getFunctions()) {
        const body = fn.getBodyText()?.trimStart() ?? ''
        if (/^['"]use server['"]/.test(body)) {
          skipped.push({
            file: rel,
            reason: 'function level use server directive, not yet supported',
          })
        }
      }
      continue
    }

    type Candidate = {
      fnName: string
      body: string
      wrapperEvidence: string[]
      authOverride?: AuthRequirement
      docNode: JSDocableNode
    }
    const candidates: Candidate[] = []
    let wrappedSkip = false
    for (const fn of sf.getFunctions()) {
      if (fn.isExported() && fn.isAsync()) {
        candidates.push({
          fnName: fn.getName() ?? 'anonymous',
          body: fn.getBodyText() ?? '',
          wrapperEvidence: [],
          docNode: fn,
        })
      }
    }
    for (const vd of sf.getVariableDeclarations()) {
      if (!vd.isExported()) continue
      // JSDoc on an exported const action sits on its VariableStatement.
      const docNode: JSDocableNode = vd.getVariableStatementOrThrow()
      const init = vd.getInitializer()
      const arrow = init?.asKind(SyntaxKind.ArrowFunction)
      if (arrow?.isAsync()) {
        candidates.push({
          fnName: vd.getName(),
          body: arrow.getBodyText() ?? '',
          wrapperEvidence: [],
          docNode,
        })
        continue
      }
      // Wrapped server action: `export const <name> = <chain>.action(<fn>)` where
      // <chain> is ANY property/call chain. The terminal `.action()` call is found
      // structurally regardless of chain shape; its argument is the handler; the
      // chain ROOT is recorded as evidence and, when its name signals auth, forces
      // `required` (server actions contract rule 2).
      if (init && Node.isCallExpression(init)) {
        const found = terminalActionCall(init)
        if (!found) continue
        const { call, root } = found
        const arg = call.getArguments()[0]
        const handler =
          asFnLike(arg) ??
          (arg && Node.isIdentifier(arg) ? resolveFn(sf, arg.getText()) : undefined)
        if (!handler) {
          skipped.push({ file: rel, reason: `wrapped server action not resolved: ${root}` })
          wrappedSkip = true
          continue
        }
        candidates.push({
          fnName: vd.getName(),
          body: handler.getBodyText() ?? handler.getText(),
          wrapperEvidence: [`wrapped server action via ${root}`],
          authOverride: rootImpliesAuth(root) ? 'required' : undefined,
          docNode,
        })
      }
    }

    for (const { fnName, body, wrapperEvidence, authOverride, docNode } of candidates) {
      const { effect, entitiesTouched, evidence } = classifyEffect(body, { sf })
      const idiomAuth = detectHandlerAuth(body, sf)
      const baseAuth =
        idiomAuth.auth === 'unknown' && authOverride === 'required'
          ? { auth: 'required' as const, evidence: ['auth required via server action client'] }
          : idiomAuth
      const { auth, evidence: authEvidence } = resolveAuth(baseAuth, undefined, [])
      const action: ActionIR = {
        name: fnToName(fnName),
        kind: 'server-action',
        sourceFile: rel,
        exportName: fnName,
        description: `server action ${fnName}`,
        inputs: extractInputs(sf, body),
        effect,
        entitiesTouched,
        enabled: effect === 'read',
        enabledBy: effect === 'read' ? 'read-default' : undefined,
        confidence: 'static',
        auth,
        preconditions: [],
        evidence: [...wrapperEvidence, ...evidence, ...authEvidence],
      }

      // A server action is a single-action declaration: act-specific tags apply.
      const doc = readAgentDoc(docNode)
      if (doc.ignore) {
        skipped.push({ file: rel, reason: 'excluded by @agent ignore' })
        continue
      }
      const applied = applyAgentDoc(action, doc, { file: rel, actSpecific: true })
      skipped.push(...applied.warnings)
      workflowBindings.push(...applied.workflowBindings)
      actions.push(action)
    }
    if (candidates.length === 0 && !wrappedSkip)
      skipped.push({ file: rel, reason: 'use server file with no exported async functions' })
  }
  return { actions, skipped, workflowBindings }
}
