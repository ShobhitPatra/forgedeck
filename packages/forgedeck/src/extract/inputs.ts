import { Node, type Expression, type SourceFile, type VariableDeclaration } from 'ts-morph'
import type { InputField } from '../ir/types.js'

const ZOD_TYPE: Record<string, InputField['type']> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
}

// A resolved schema field before a parse-call location is attached.
type RawField = Omit<InputField, 'location'>

const MAX_DEPTH = 4

// Locate a schema declaration by name: a local `const`, else a named import
// whose target file we can resolve. No initializer-shape restriction — the
// initializer may be a plain `z.object` or a composition chain.
function findDecl(sf: SourceFile, name: string): VariableDeclaration | undefined {
  const local = sf.getVariableDeclaration(name)
  if (local) return local
  for (const imp of sf.getImportDeclarations()) {
    if (!imp.getNamedImports().some((n) => n.getName() === name)) continue
    const decl = imp.getModuleSpecifierSourceFile()?.getVariableDeclaration(name)
    if (decl) return decl
  }
  return undefined
}

function fieldsFromObjectLiteral(arg: Node | undefined): RawField[] {
  if (!arg || !Node.isObjectLiteralExpression(arg)) return []
  const fields: RawField[] = []
  for (const prop of arg.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue
    const chainText = prop.getInitializer()?.getText() ?? ''
    const base =
      chainText
        .match(/^z\.([\w.]+)\(/)?.[1]
        ?.split('.')
        .pop() ?? ''
    fields.push({
      name: prop.getName(),
      type: ZOD_TYPE[base] ?? 'unknown',
      required: !/\.(optional|default)\(/.test(chainText),
    })
  }
  return fields
}

// Union of two field lists; a later field with a duplicate name wins in place.
function mergeFields(base: RawField[], add: RawField[]): RawField[] {
  const out = [...base]
  for (const f of add) {
    const idx = out.findIndex((x) => x.name === f.name)
    if (idx >= 0) out[idx] = f
    else out.push(f)
  }
  return out
}

// Keys of an object literal whose value is `true` (the `.pick`/`.omit` mask).
function keysWithTrue(arg: Node | undefined): Set<string> {
  const keys = new Set<string>()
  if (!arg || !Node.isObjectLiteralExpression(arg)) return keys
  for (const prop of arg.getProperties()) {
    if (Node.isPropertyAssignment(prop) && prop.getInitializer()?.getText() === 'true') {
      keys.add(prop.getName())
    }
  }
  return keys
}

// Resolve the fields declared by a schema initializer, following composition
// (.extend/.merge/.pick/.omit/.partial) across local and imported bases.
function fieldsFromInitializer(
  init: Expression | undefined,
  sf: SourceFile,
  depth: number,
  seen: Set<string>,
): RawField[] {
  if (!init) return []
  if (Node.isIdentifier(init)) return resolveSchema(init.getText(), sf, depth + 1, seen)
  if (!Node.isCallExpression(init)) return []

  const callee = init.getExpression()
  if (!Node.isPropertyAccessExpression(callee)) return []
  const method = callee.getName()
  const receiver = callee.getExpression()
  const args = init.getArguments()

  if (method === 'object' && receiver.getText() === 'z') {
    return fieldsFromObjectLiteral(args[0])
  }
  if (method === 'extend' || method === 'merge') {
    const base = fieldsFromInitializer(receiver, sf, depth, seen)
    const add =
      method === 'extend'
        ? fieldsFromObjectLiteral(args[0])
        : fieldsFromInitializer(args[0] as Expression, sf, depth + 1, seen)
    return mergeFields(base, add)
  }
  if (method === 'pick' || method === 'omit') {
    const base = fieldsFromInitializer(receiver, sf, depth, seen)
    const keys = keysWithTrue(args[0])
    return method === 'pick'
      ? base.filter((f) => keys.has(f.name))
      : base.filter((f) => !keys.has(f.name))
  }
  if (method === 'partial') {
    return fieldsFromInitializer(receiver, sf, depth, seen).map((f) => ({ ...f, required: false }))
  }
  // Any other chained method (.strict, .refine, ...) is transparent to fields.
  return fieldsFromInitializer(receiver, sf, depth, seen)
}

// Resolve a named schema to its fields; depth-bounded and cycle-safe.
function resolveSchema(name: string, sf: SourceFile, depth: number, seen: Set<string>): RawField[] {
  if (depth > MAX_DEPTH || seen.has(name)) return []
  seen.add(name)
  const decl = findDecl(sf, name)
  if (!decl) return []
  return fieldsFromInitializer(decl.getInitializer(), decl.getSourceFile(), depth, seen)
}

function locationForParseCall(handlerBodyText: string, schemaName: string): InputField['location'] {
  const m = handlerBodyText.match(new RegExp(`\\b${schemaName}\\.(?:safeParse|parse)\\(([^)]*)`))
  const arg = m?.[1] ?? ''
  if (/searchParams|req\.query|fromEntries/.test(arg)) return 'query'
  return 'body'
}

// The App-Router idiom for reading a single query param: `searchParams.get('x')`,
// reached via `req.nextUrl.searchParams`, `new URL(req.url).searchParams`, or a
// bare `searchParams` local. Every distinct literal name is a query input; zod
// (when present) already knows real types/required, so this is purely additive.
const SEARCHPARAM_RE = /\bsearchParams\.get\(\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\s*\)/g

function searchParamFields(handlerBodyText: string): InputField[] {
  const names = new Set<string>()
  for (const m of handlerBodyText.matchAll(SEARCHPARAM_RE)) names.add(m[1])
  return [...names].map((name) => ({
    name,
    type: 'string' as const,
    required: false,
    location: 'query' as const,
  }))
}

export function extractInputs(
  sourceFile: SourceFile,
  handlerBodyText: string,
  evidence?: string[],
): InputField[] {
  const used = [...handlerBodyText.matchAll(/\b(\w+)\.(?:safeParse|parse)\(/g)].map((m) => m[1])
  const result: InputField[] = []
  const names = new Set<string>()
  for (const schemaName of used) {
    if (schemaName === 'JSON') continue
    const fields = resolveSchema(schemaName, sourceFile, 0, new Set())
    if (fields.length === 0) continue
    const location = locationForParseCall(handlerBodyText, schemaName)
    // Multi-schema handlers merge; the first declaration of a name wins.
    for (const f of fields) {
      if (names.has(f.name)) continue
      names.add(f.name)
      result.push({ ...f, location })
    }
  }

  // searchParams.get(...) fields are additive: zod already claimed a name wins
  // (it knows the real type/required), a survivor is a genuinely new input.
  const searchParams = searchParamFields(handlerBodyText).filter((f) => !names.has(f.name))
  if (searchParams.length > 0) {
    result.push(...searchParams)
    evidence?.push('query params via searchParams.get')
  }

  if (result.length > 0) return result

  const bare: InputField[] = []
  for (const src of ['query', 'body'] as const) {
    const m = handlerBodyText.match(new RegExp(`const\\s*\\{([^}]+)\\}\\s*=\\s*req\\.${src}`))
    if (m) {
      for (const raw of m[1].split(',')) {
        const name = raw.split(':')[0].trim()
        if (/^\w+$/.test(name)) bare.push({ name, type: 'unknown', required: false, location: src })
      }
    }
  }
  return bare
}
