import {
  Node,
  type SourceFile,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
  type IfStatement,
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
    if (new RegExp(`req\\.method\\s*===\\s*['"]${m}['"]`).test(condition)) return m
  }
  return undefined
}

// `req.method !== 'M'` — the discriminator of an early-return guard.
function methodOfNegatedCondition(condition: string): string | undefined {
  for (const m of METHODS) {
    if (new RegExp(`req\\.method\\s*!==?\\s*['"]${m}['"]`).test(condition)) return m
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

type Branch = { method: string; text: string; evidence: string[] }

// An `if (req.method === 'M')` head plus its `else if` chain: each method arm
// becomes its own branch carrying only its arm body; a trailing bare `else`
// (the 405 dead-end) is ignored (contract rule 1).
function collectIfChain(head: IfStatement): Branch[] {
  const out: Branch[] = []
  let current: Node | undefined = head
  let first = true
  while (current && Node.isIfStatement(current)) {
    const method = methodOfCondition(current.getExpression().getText())
    if (method) {
      out.push({
        method,
        text: current.getThenStatement().getText(),
        evidence: [`method ${method} via ${first ? 'if' : 'else if'} branch`],
      })
    }
    first = false
    current = current.getElseStatement()
  }
  return out
}

// `if (req.method !== 'M') return ...` — the then-branch bails, so the method
// is constrained to M for the remainder of the function (contract rule 2).
function isReturnGuard(stmt: IfStatement): boolean {
  const then = stmt.getThenStatement()
  if (Node.isReturnStatement(then)) return true
  if (Node.isBlock(then)) return then.getStatements().some((s) => Node.isReturnStatement(s))
  return false
}

// `const handlers = { GET: fn, POST: fn }` at file scope: each key is a method
// branch whose text is the mapped handler's body (contract rule 3).
function detectHandlerMap(sf: SourceFile): Branch[] {
  for (const vd of sf.getVariableDeclarations()) {
    const init = vd.getInitializer()
    if (!init || !Node.isObjectLiteralExpression(init)) continue
    const branches: Branch[] = []
    let allMethods = true
    for (const prop of init.getProperties()) {
      if (!Node.isPropertyAssignment(prop)) {
        allMethods = false
        break
      }
      const key = prop.getName().replace(/['"]/g, '')
      if (!(METHODS as readonly string[]).includes(key)) {
        allMethods = false
        break
      }
      const value = prop.getInitializerOrThrow()
      let text = ''
      if (Node.isIdentifier(value)) {
        const fn = resolveLocalHandler(sf, value.getText())
        text = fn?.getBody()?.getText() ?? fn?.getText() ?? ''
      } else if (Node.isArrowFunction(value) || Node.isFunctionExpression(value)) {
        text = value.getBody()?.getText() ?? value.getText()
      }
      branches.push({ method: key, text, evidence: [`method ${key} via handler map`] })
    }
    if (allMethods && branches.length > 0) return branches
  }
  return []
}

// Split the handler body into discriminated method branches + undiscriminated
// tail. Understands else-if dispatch, early-return guards, handler maps and
// method switches (control-flow contract rules 1-4).
function segmentBody(
  node: FnLike,
  sf: SourceFile,
): {
  found: Branch[]
  tail: string
  wholeText: string
  note?: string
} {
  const found: Branch[] = []
  const tailParts: string[] = []
  const body = node.getBody()
  const wholeText = body?.getText() ?? node.getText()

  if (!body || !Node.isBlock(body)) return { found, tail: wholeText, wholeText }

  // Rule 3: a file-scope handler map short-circuits statement analysis.
  const mapBranches = detectHandlerMap(sf)
  if (mapBranches.length > 0) return { found: mapBranches, tail: '', wholeText }

  const statements = body.getStatements()
  const guardMethods: string[] = []
  let lastGuardIndex = -1

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]
    if (Node.isIfStatement(stmt)) {
      const cond = stmt.getExpression().getText()
      if (methodOfCondition(cond)) {
        for (const branch of collectIfChain(stmt)) found.push(branch)
        continue
      }
      const negated = methodOfNegatedCondition(cond)
      if (negated && isReturnGuard(stmt)) {
        guardMethods.push(negated)
        lastGuardIndex = i
        continue
      }
    } else if (Node.isSwitchStatement(stmt) && /req\.method/.test(stmt.getExpression().getText())) {
      for (const clause of stmt.getClauses()) {
        const method = Node.isCaseClause(clause)
          ? methodOfCaseLabel(clause.getExpression().getText())
          : undefined
        // rule 4: a `default:` clause is a dead-end and contributes no branch.
        if (method) {
          found.push({
            method,
            text: clause.getText(),
            evidence: [`method ${method} via switch case`],
          })
        }
      }
      continue
    }
    tailParts.push(stmt.getText())
  }

  // Rule 2: with method guards and no explicit dispatch, the code after the last
  // guard is the guarded method's handler. Contradictory guards fall back to POST.
  if (found.length === 0 && guardMethods.length > 0) {
    const distinct = [...new Set(guardMethods)]
    const remainder = statements
      .slice(lastGuardIndex + 1)
      .map((s) => s.getText())
      .join('\n')
    if (distinct.length === 1) {
      return {
        found: [
          {
            method: distinct[0],
            text: remainder,
            evidence: [`method ${distinct[0]} via early return guard`],
          },
        ],
        tail: '',
        wholeText,
      }
    }
    return {
      found: [
        { method: 'POST', text: remainder, evidence: ['method POST via conservative default'] },
      ],
      tail: '',
      wholeText,
      note: 'contradictory method guards',
    }
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

    const emit = (method: string, text: string, methodEvidence: string[]): void => {
      const { effect, entitiesTouched, evidence } = classifyEffect(text, { method, sf })
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
        evidence: [...methodEvidence, ...evidence],
      })
    }

    const { found, tail, wholeText, note } = segmentBody(resolved.node, sf)
    if (note) skipped.push({ file: rel, reason: note })

    if (found.length === 0) {
      emit('POST', wholeText, ['method POST via conservative default'])
      skipped.push({ file: rel, reason: 'no method discrimination found, treated as POST' })
      continue
    }

    for (const branch of found) emit(branch.method, branch.text, branch.evidence)

    // Trailing undiscriminated code (the [id].ts pattern) is attributed to the
    // read-most method GET, classified from its own text, and logged for honesty.
    if (/\b(prisma|db)\.|await\s/.test(tail)) {
      emit('GET', tail, ['method GET via undiscriminated tail'])
      skipped.push({
        file: rel,
        reason: 'undiscriminated code after method branches, attributed to GET',
      })
    }
  }

  return { actions, skipped }
}
