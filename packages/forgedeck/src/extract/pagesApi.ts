import {
  Node,
  type SourceFile,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
} from 'ts-morph'
import type { ActionIR, CoverageItem, InputField } from '../ir/types.js'
import type { LoadedProject } from '../load/project.js'
import { routeToName, paramsFromPath } from '../ir/names.js'
import { classifyEffect } from './effects.js'
import { extractInputs } from './inputs.js'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
type FnLike = FunctionDeclaration | ArrowFunction | FunctionExpression

// pages/api/documents/[id].ts -> /api/documents/{id}
function pagesPathFromFile(rel: string): string {
  const noPages = rel
    .replace(/^(src\/)?pages\//, '')
    .replace(/\.tsx?$/, '')
    .replace(/\/index$/, '')
  const segments = noPages
    .split('/')
    .map((s) => (s.startsWith('[') && s.endsWith(']') ? `{${s.slice(1, -1)}}` : s))
  return '/' + segments.join('/')
}

// non-global regexes so repeated .test() calls stay stateless (grill patch)
function methodOfCondition(condition: string): string | undefined {
  for (const m of METHODS) {
    if (new RegExp(`req\\.method\\s*===?\\s*['"]${m}['"]`).test(condition)) return m
  }
  return undefined
}

function methodOfCaseLabel(label: string): string | undefined {
  const bare = label.replace(/['"]/g, '')
  return (METHODS as readonly string[]).includes(bare) ? bare : undefined
}

function resolveLocalHandler(sf: SourceFile, name: string): FnLike | undefined {
  const fn = sf.getFunction(name)
  if (fn) return fn
  const init = sf.getVariableDeclaration(name)?.getInitializer()
  if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) return init
  return undefined
}

type Resolution =
  { kind: 'ok'; node: FnLike } | { kind: 'none' } | { kind: 'wrapper'; name: string }

// Resolve the default-exported handler across all four real-world forms.
function resolveHandler(sf: SourceFile): Resolution {
  // Form 1: export default (async) function handler(...) {}
  const declFn = sf.getFunctions().find((f) => f.isDefaultExport())
  if (declFn) return { kind: 'ok', node: declFn }

  const assignment = sf.getExportAssignment((a) => !a.isExportEquals())
  if (!assignment) return { kind: 'none' }
  const expr = assignment.getExpression()

  // Form 2: export default (req, res) => {} / function expression
  if (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr))
    return { kind: 'ok', node: expr }

  // Form 3: export default handler -> resolve local declaration
  if (Node.isIdentifier(expr)) {
    const node = resolveLocalHandler(sf, expr.getText())
    return node ? { kind: 'ok', node } : { kind: 'none' }
  }

  // Form 4: export default withX(handler) -> unwrap one level, resolve first arg
  if (Node.isCallExpression(expr)) {
    const wrapperName = expr.getExpression().getText()
    const arg = expr.getArguments()[0]
    if (arg) {
      if (Node.isIdentifier(arg)) {
        const node = resolveLocalHandler(sf, arg.getText())
        if (node) return { kind: 'ok', node }
      } else if (Node.isArrowFunction(arg) || Node.isFunctionExpression(arg)) {
        return { kind: 'ok', node: arg }
      }
    }
    return { kind: 'wrapper', name: wrapperName }
  }
  return { kind: 'none' }
}

// Split the handler body into discriminated method branches + undiscriminated tail.
function segmentBody(node: FnLike): {
  found: { method: string; text: string }[]
  tail: string
  wholeText: string
} {
  const found: { method: string; text: string }[] = []
  const tailParts: string[] = []
  const body = node.getBody()
  const wholeText = body?.getText() ?? node.getText()

  if (body && Node.isBlock(body)) {
    for (const stmt of body.getStatements()) {
      if (Node.isIfStatement(stmt)) {
        const method = methodOfCondition(stmt.getExpression().getText())
        if (method) {
          found.push({ method, text: stmt.getText() })
          continue
        }
      } else if (
        Node.isSwitchStatement(stmt) &&
        /req\.method/.test(stmt.getExpression().getText())
      ) {
        for (const clause of stmt.getClauses()) {
          const method = Node.isCaseClause(clause)
            ? methodOfCaseLabel(clause.getExpression().getText())
            : undefined
          if (method) found.push({ method, text: clause.getText() })
          else tailParts.push(clause.getText())
        }
        continue
      }
      tailParts.push(stmt.getText())
    }
  } else {
    tailParts.push(wholeText)
  }

  return { found, tail: tailParts.join('\n'), wholeText }
}

export function extractPagesApi(loaded: LoadedProject): {
  actions: ActionIR[]
  skipped: CoverageItem[]
} {
  const actions: ActionIR[] = []
  const skipped: CoverageItem[] = []
  if (!loaded.pagesApiDir) return { actions, skipped }

  for (const sf of loaded.project.getSourceFiles()) {
    const rel = loaded.relPath(sf.getFilePath())
    if (!/^(src\/)?pages\/api\//.test(rel)) continue

    const resolved = resolveHandler(sf)
    if (resolved.kind === 'none') {
      skipped.push({ file: rel, reason: 'no default export handler found' })
      continue
    }
    if (resolved.kind === 'wrapper') {
      skipped.push({ file: rel, reason: `wrapped default export not resolved: ${resolved.name}` })
      continue
    }

    const path = pagesPathFromFile(rel)
    const pathInputs: InputField[] = paramsFromPath(path).map((p) => ({
      name: p,
      type: 'string',
      required: true,
      location: 'path',
    }))

    const emit = (method: string, text: string): void => {
      const { effect, entitiesTouched } = classifyEffect(text, { method })
      actions.push({
        name: routeToName(method, path),
        kind: 'pages-api',
        method,
        path,
        sourceFile: rel,
        exportName: 'default',
        description: `${method} ${path}`,
        inputs: [...pathInputs, ...extractInputs(sf, text)],
        effect,
        entitiesTouched,
        enabled: effect === 'read',
        confidence: 'static',
        auth: 'unknown' as const,
        evidence: [],
      })
    }

    const { found, tail, wholeText } = segmentBody(resolved.node)

    if (found.length === 0) {
      emit('POST', wholeText)
      skipped.push({ file: rel, reason: 'no method discrimination found, treated as POST' })
      continue
    }

    for (const branch of found) emit(branch.method, branch.text)

    // Trailing undiscriminated code (the [id].ts pattern) is attributed to the
    // read-most method GET, classified from its own text, and logged for honesty.
    if (/\b(prisma|db)\.|await\s/.test(tail)) {
      emit('GET', tail)
      skipped.push({
        file: rel,
        reason: 'undiscriminated code after method branches, attributed to GET',
      })
    }
  }

  return { actions, skipped }
}
