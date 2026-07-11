import { Node, type SourceFile } from 'ts-morph'
import type { ActionIR, CoverageItem, InputField } from '../ir/types.js'
import type { LoadedProject } from '../load/project.js'
import { routePathFromFile, routeToName, paramsFromPath } from '../ir/names.js'
import { classifyEffect } from './effects.js'
import { extractInputs } from './inputs.js'
import {
  detectHandlerAuth,
  detectWrapperAuth,
  resolveAuth,
  isAuthPlumbingRoute,
  type AuthResult,
  type Matcher,
} from './auth.js'
import { asFnLike, handlerFromWrapperArg } from './unwrap.js'

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

// A resolved method export: its handler body text, an optional wrapper name (for
// auth) and any wrapper evidence; or a wrapper whose handler stayed opaque.
type MethodResolution =
  | { kind: 'body'; body: string; wrapper?: string; evidence: string[] }
  | { kind: 'unresolved'; wrapper: string }
  | undefined

// Handlers come in three mainstream styles: function declarations, exported const
// arrow/function expressions, and — the modern Next.js idiom — an exported const
// bound to a wrapper CallExpression (`export const GET = withX({ handler })`).
// The last is unwrapped ONE level: the callee is the wrapper (an auth signal), and
// the handler is recovered from its first argument (contract rule 1).
function resolveMethod(sf: SourceFile, method: string): MethodResolution {
  const fn = sf.getFunction(method)
  if (fn?.isExported()) return { kind: 'body', body: fn.getBodyText() ?? '', evidence: [] }

  const vd = sf.getVariableDeclaration(method)
  if (!vd?.isExported()) return undefined
  const init = vd.getInitializer()
  if (!init) return undefined

  const inline = asFnLike(init)
  if (inline) return { kind: 'body', body: inline.getText(), evidence: [] }

  if (Node.isCallExpression(init)) {
    const wrapper = init.getExpression().getText()
    const arg = init.getArguments()[0]
    const handler = arg ? handlerFromWrapperArg(sf, arg) : undefined
    if (handler)
      return {
        kind: 'body',
        body: handler.getText(),
        wrapper,
        evidence: [`handler via wrapper ${wrapper}`],
      }
    return { kind: 'unresolved', wrapper }
  }
  return undefined
}

export function extractRoutes(
  loaded: LoadedProject,
  matchers: Matcher[] = [],
): {
  actions: ActionIR[]
  skipped: CoverageItem[]
} {
  const actions: ActionIR[] = []
  const skipped: CoverageItem[] = []

  for (const sf of loaded.project.getSourceFiles()) {
    const rel = loaded.relPath(sf.getFilePath())
    if (!/(^|\/)route\.tsx?$/.test(rel)) continue
    if (isAuthPlumbingRoute(rel)) {
      skipped.push({ file: rel, reason: 'auth plumbing route, excluded' })
      continue
    }

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
      const resolved = resolveMethod(sf, method)
      if (resolved === undefined) continue
      found++
      if (resolved.kind === 'unresolved') {
        skipped.push({
          file: rel,
          reason: `wrapped route handler not resolved: ${resolved.wrapper}`,
        })
        continue
      }
      const { body, wrapper, evidence: wrapperEvidence } = resolved
      const { effect, entitiesTouched, evidence } = classifyEffect(body, { method, sf })

      // A wrapper name that reads as authentication (`withAuth`, ...) protects the
      // handler; a handler-level session idiom still wins over a neutral wrapper.
      const idiomAuth = detectHandlerAuth(body, sf)
      const wrapperAuth: AuthResult = wrapper
        ? detectWrapperAuth(wrapper)
        : { auth: 'unknown', evidence: [] }
      const handlerAuth = idiomAuth.auth === 'required' ? idiomAuth : wrapperAuth
      const { auth, evidence: authEvidence } = resolveAuth(handlerAuth, path, matchers)

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
        auth,
        evidence: [...wrapperEvidence, ...evidence, ...authEvidence],
      })
    }
    if (found === 0) skipped.push({ file: rel, reason: 'no http method exports found' })
  }
  return { actions, skipped }
}
