import { SyntaxKind } from 'ts-morph'
import type { ActionIR, CoverageItem } from '../ir/types.js'
import type { LoadedProject } from '../load/project.js'
import { fnToName } from '../ir/names.js'
import { classifyEffect } from './effects.js'
import { extractInputs } from './inputs.js'
import { detectHandlerAuth, resolveAuth } from './auth.js'

export function extractServerActions(loaded: LoadedProject): {
  actions: ActionIR[]
  skipped: CoverageItem[]
} {
  const actions: ActionIR[] = []
  const skipped: CoverageItem[] = []

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

    const candidates: { fnName: string; body: string }[] = []
    for (const fn of sf.getFunctions()) {
      if (fn.isExported() && fn.isAsync()) {
        candidates.push({ fnName: fn.getName() ?? 'anonymous', body: fn.getBodyText() ?? '' })
      }
    }
    for (const vd of sf.getVariableDeclarations()) {
      if (!vd.isExported()) continue
      const arrow = vd.getInitializer()?.asKind(SyntaxKind.ArrowFunction)
      if (arrow?.isAsync())
        candidates.push({ fnName: vd.getName(), body: arrow.getBodyText() ?? '' })
    }

    for (const { fnName, body } of candidates) {
      const { effect, entitiesTouched, evidence } = classifyEffect(body, { sf })
      const { auth, evidence: authEvidence } = resolveAuth(
        detectHandlerAuth(body, sf),
        undefined,
        [],
      )
      actions.push({
        name: fnToName(fnName),
        kind: 'server-action',
        sourceFile: rel,
        exportName: fnName,
        description: `server action ${fnName}`,
        inputs: extractInputs(sf, body),
        effect,
        entitiesTouched,
        enabled: effect === 'read',
        confidence: 'static',
        auth,
        evidence: [...evidence, ...authEvidence],
      })
    }
    if (candidates.length === 0)
      skipped.push({ file: rel, reason: 'use server file with no exported async functions' })
  }
  return { actions, skipped }
}
