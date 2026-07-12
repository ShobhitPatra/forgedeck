import { Node, type SourceFile, type JSDocableNode } from 'ts-morph'
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
import { readAgentDoc, hasAgentAnnotations } from './jsdoc.js'
import { applyAgentDoc, type WorkflowBinding } from './annotate.js'

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

// A resolved method export: its handler body text, an optional wrapper name (for
// auth) and any wrapper evidence; or a wrapper whose handler stayed opaque.
type MethodResolution =
  | { kind: 'body'; body: string; wrapper?: string; evidence: string[]; docNode: JSDocableNode }
  | { kind: 'unresolved'; wrapper: string }
  | undefined

// A re-exported handler target: its resolution, the source file the body lives in
// (so effects/inputs scan the right module), and that file's project-relative path
// for evidence.
interface ReExport {
  resolution: MethodResolution
  targetSf: SourceFile
  relpath: string
}

// Handlers come in three mainstream styles: function declarations, exported const
// arrow/function expressions, and — the modern Next.js idiom — an exported const
// bound to a wrapper CallExpression (`export const GET = withX({ handler })`).
// The last is unwrapped ONE level: the callee is the wrapper (an auth signal), and
// the handler is recovered from its first argument (contract rule 1). Keyed on any
// exported name so it serves both local methods and re-export targets.
function resolveDeclaration(sf: SourceFile, name: string): MethodResolution {
  const fn = sf.getFunction(name)
  if (fn?.isExported())
    return { kind: 'body', body: fn.getBodyText() ?? '', evidence: [], docNode: fn }

  const vd = sf.getVariableDeclaration(name)
  if (!vd?.isExported()) return undefined
  // JSDoc on a `const` handler sits on the VariableStatement, not the declaration.
  const docNode: JSDocableNode = vd.getVariableStatementOrThrow()
  const init = vd.getInitializer()
  if (!init) return undefined

  const inline = asFnLike(init)
  if (inline) return { kind: 'body', body: inline.getText(), evidence: [], docNode }

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
        docNode,
      }
    return { kind: 'unresolved', wrapper }
  }
  return undefined
}

// A `route.ts` may surface its methods via barrel re-exports
// (`export { GET, POST } from '<spec>'`, including `export { x as GET }`). Resolve
// the specifier's source file and, for each named export whose EXPORTED (alias)
// name is a recognised METHOD, resolve the target declaration in that file. The
// resolved bodies are keyed by their exported method name. `export *` is out of
// scope; an unresolvable specifier or missing target export is skip-logged.
function collectReExports(
  sf: SourceFile,
  loaded: LoadedProject,
): { map: Map<string, ReExport>; skipped: CoverageItem[] } {
  const map = new Map<string, ReExport>()
  const skipped: CoverageItem[] = []
  const rel = loaded.relPath(sf.getFilePath())

  for (const ed of sf.getExportDeclarations()) {
    if (!ed.hasModuleSpecifier()) continue
    const spec = ed.getModuleSpecifierValue() ?? ''
    const named = ed.getNamedExports()
    if (named.length === 0) {
      // `export * from '<spec>'` (and `export * as ns`) — not followed by contract.
      skipped.push({ file: rel, reason: 'wildcard re export not followed' })
      continue
    }
    const methodSpecs = named
      .map((n) => ({ target: n.getName(), exported: n.getAliasNode()?.getText() ?? n.getName() }))
      .filter((n) => (HTTP_METHODS as readonly string[]).includes(n.exported))
    if (methodSpecs.length === 0) continue

    const targetSf = ed.getModuleSpecifierSourceFile()
    if (!targetSf) {
      skipped.push({ file: rel, reason: `re exported handler not resolved: ${spec}` })
      continue
    }
    const relpath = loaded.relPath(targetSf.getFilePath())
    for (const ms of methodSpecs) {
      const resolution = resolveDeclaration(targetSf, ms.target)
      if (!resolution) {
        skipped.push({ file: rel, reason: `re exported handler not resolved: ${spec}` })
        continue
      }
      map.set(ms.exported, { resolution, targetSf, relpath })
    }
  }
  return { map, skipped }
}

// forgedeck's own MCP shim (`export const { GET, POST } = createForgedeckHandler()`
// with the import from 'forgedeck/next') is infrastructure, not an app action: it
// SERVES the agent surface rather than belonging on it. Without this check the
// extractor warns 'wrapped route handler not resolved: createForgedeckHandler' for
// every method on every build — noise about our own plumbing. Recognized by the
// import (specifier + name), not the file path, so the shim can live at any route.
function isForgedeckMcpRoute(sf: SourceFile): boolean {
  return sf
    .getImportDeclarations()
    .some(
      (imp) =>
        imp.getModuleSpecifierValue() === 'forgedeck/next' &&
        imp.getNamedImports().some((s) => s.getName() === 'createForgedeckHandler'),
    )
}

// A plumbing route (`app/api/auth/[...nextauth]/route.ts`) is auto-excluded UNLESS a
// human annotated it: scan every resolvable method declaration (local or re-exported)
// for any @agent tag or JSDoc summary. One annotated method surfaces the route.
function routeIsAnnotated(sf: SourceFile, loaded: LoadedProject): boolean {
  const reExports = collectReExports(sf, loaded).map
  for (const method of HTTP_METHODS) {
    const resolved = resolveDeclaration(sf, method) ?? reExports.get(method)?.resolution
    if (resolved?.kind === 'body' && hasAgentAnnotations(readAgentDoc(resolved.docNode)))
      return true
  }
  return false
}

export function extractRoutes(
  loaded: LoadedProject,
  matchers: Matcher[] = [],
): {
  actions: ActionIR[]
  skipped: CoverageItem[]
  workflowBindings: WorkflowBinding[]
} {
  const actions: ActionIR[] = []
  const skipped: CoverageItem[] = []
  const workflowBindings: WorkflowBinding[] = []

  for (const sf of loaded.project.getSourceFiles()) {
    const rel = loaded.relPath(sf.getFilePath())
    if (!/(^|\/)route\.tsx?$/.test(rel)) continue
    // Our own MCP shim route serves the agent surface — never extracted onto it.
    if (isForgedeckMcpRoute(sf)) {
      skipped.push({ file: rel, reason: 'forgedeck mcp route' })
      continue
    }
    // Auth plumbing is excluded only while un-annotated; an @agent tag or JSDoc
    // summary on any method is a human decision to surface it (human facts win).
    const plumbing = isAuthPlumbingRoute(rel)
    if (plumbing && !routeIsAnnotated(sf, loaded)) {
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
    const reExports = collectReExports(sf, loaded)
    skipped.push(...reExports.skipped)

    for (const method of HTTP_METHODS) {
      // A method resolves locally (declaration in this file) or, failing that,
      // through a barrel re-export whose body lives in the target module.
      let resolved = resolveDeclaration(sf, method)
      let effectSf = sf
      let reEvidence: string[] = []
      if (resolved === undefined) {
        const re = reExports.map.get(method)
        if (re) {
          resolved = re.resolution
          effectSf = re.targetSf
          reEvidence = [`handler via re export from ${re.relpath}`]
        }
      }
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
      const { effect, entitiesTouched, evidence } = classifyEffect(body, { method, sf: effectSf })

      // A wrapper name that reads as authentication (`withAuth`, ...) protects the
      // handler; a handler-level session idiom still wins over a neutral wrapper.
      const idiomAuth = detectHandlerAuth(body, effectSf)
      const wrapperAuth: AuthResult = wrapper
        ? detectWrapperAuth(wrapper)
        : { auth: 'unknown', evidence: [] }
      const handlerAuth = idiomAuth.auth === 'required' ? idiomAuth : wrapperAuth
      const { auth, evidence: authEvidence } = resolveAuth(handlerAuth, path, matchers)

      const action: ActionIR = {
        name: routeToName(method, path),
        kind: 'route',
        method,
        path,
        sourceFile: rel,
        exportName: method,
        description: `${method} ${path}`,
        inputs: [...pathInputs, ...extractInputs(effectSf, body)],
        effect,
        entitiesTouched,
        enabled: effect === 'read',
        enabledBy: effect === 'read' ? 'read-default' : undefined,
        confidence: 'static',
        auth,
        preconditions: [],
        evidence: [
          ...reEvidence,
          ...wrapperEvidence,
          ...evidence,
          ...authEvidence,
          ...(plumbing ? ['auth plumbing exclusion overridden by annotations'] : []),
        ],
      }

      // A route method is a single-action declaration: act-specific tags apply.
      const doc = readAgentDoc(resolved.docNode)
      if (doc.ignore) {
        skipped.push({ file: rel, reason: 'excluded by @agent ignore' })
        continue
      }
      const applied = applyAgentDoc(action, doc, { file: rel, actSpecific: true })
      skipped.push(...applied.warnings)
      workflowBindings.push(...applied.workflowBindings)
      actions.push(action)
    }
    if (found === 0 && reExports.skipped.length === 0) {
      skipped.push({ file: rel, reason: 'no http method exports found' })
    }
  }
  return { actions, skipped, workflowBindings }
}
