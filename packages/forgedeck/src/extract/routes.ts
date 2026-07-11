import { SyntaxKind, type SourceFile } from 'ts-morph'
import type { ActionIR, CoverageItem, InputField } from '../ir/types.js'
import type { LoadedProject } from '../load/project.js'
import { routePathFromFile, routeToName, paramsFromPath } from '../ir/names.js'
import { classifyEffect } from './effects.js'
import { extractInputs } from './inputs.js'

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

// Handlers come in two mainstream styles: function declarations and
// exported const arrow/function expressions (grill patch Q1)
function handlerBody(sf: SourceFile, method: string): string | undefined {
  const fn = sf.getFunction(method)
  if (fn?.isExported()) return fn.getBodyText() ?? ''
  const vd = sf.getVariableDeclaration(method)
  if (vd?.isExported()) {
    const init = vd.getInitializer()
    if (init?.asKind(SyntaxKind.ArrowFunction) || init?.asKind(SyntaxKind.FunctionExpression)) {
      return init.getText()
    }
  }
  return undefined
}

export function extractRoutes(loaded: LoadedProject): {
  actions: ActionIR[]
  skipped: CoverageItem[]
} {
  const actions: ActionIR[] = []
  const skipped: CoverageItem[] = []

  for (const sf of loaded.project.getSourceFiles()) {
    const rel = loaded.relPath(sf.getFilePath())
    if (!/(^|\/)route\.tsx?$/.test(rel)) continue

    const relFromApp = rel.replace(/^src\//, '')
    const path = routePathFromFile(relFromApp)
    const pathInputs: InputField[] = paramsFromPath(path).map((p) => ({
      name: p,
      type: 'string',
      required: true,
      location: 'path' as const,
    }))
    let found = 0

    for (const method of HTTP_METHODS) {
      const body = handlerBody(sf, method)
      if (body === undefined) continue
      found++
      const { effect, entitiesTouched } = classifyEffect(body, { method })
      actions.push({
        name: routeToName(method, path),
        kind: 'route',
        method,
        path,
        sourceFile: rel,
        exportName: method,
        description: `${method} ${path}`,
        inputs: [...pathInputs, ...extractInputs(sf, body)],
        effect,
        entitiesTouched,
        enabled: effect === 'read',
        confidence: 'static',
        auth: 'unknown' as const,
        evidence: [],
      })
    }
    if (found === 0) skipped.push({ file: rel, reason: 'no http method exports found' })
  }
  return { actions, skipped }
}
