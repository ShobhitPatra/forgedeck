import { Node, Project, type Expression, type SourceFile, type VariableDeclaration } from 'ts-morph'
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

// Find a variable declaration by name anywhere in a source file, including ones
// nested inside a function body. `SourceFile.getVariableDeclaration` (used by
// `findDecl`) only sees top-level declarations, so the wrapper path — which
// resolves schemas declared inside the handler — needs this deeper search.
function findNestedDecl(sf: SourceFile, name: string): VariableDeclaration | undefined {
  let found: VariableDeclaration | undefined
  sf.forEachDescendant((node, traversal) => {
    if (Node.isVariableDeclaration(node) && node.getName() === name) {
      found = node
      traversal.stop()
    }
  })
  return found
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

// Shared by both the named-schema and inline-schema parse-call paths: a
// `searchParams`/`req.query`/`fromEntries` argument means the parsed value
// came from the query string, anything else is a body.
function locationFromArgsText(argsText: string): InputField['location'] {
  if (/searchParams|req\.query|fromEntries/.test(argsText)) return 'query'
  return 'body'
}

// The argument text of a named schema's `.parse`/`.safeParse` call (whatever the
// schema was handed to validate). Empty when the call cannot be located.
function argsForParseCall(handlerBodyText: string, schemaName: string): string {
  const m = handlerBodyText.match(new RegExp(`\\b${schemaName}\\.(?:safeParse|parse)\\(([^)]*)`))
  return m?.[1] ?? ''
}

// A parse argument "parses the request" when it traces to the incoming request
// object — its body or its query — rather than to a derived/nested local. Body
// forms (`req.body`, `request.body`, `await req.json()`) and query forms
// (`req.query`, `searchParams`, `Object.fromEntries(...)`, `req.url`) all count.
// A schema whose argument is any other identifier (e.g. `linkData.watermarkConfig`)
// is an *interior* schema validating a derived value, not the request contract.
const REQUEST_BOUND_ARG_RE =
  /\bsearchParams\b|\bfromEntries\b|\b(?:req|request)\.(?:body|query|url)\b|\b(?:req|request)\.json\s*\(/

// A structural read of the request body/query into a destructure —
// `const { ... } = req.body | req.query | await req.json()`. Its presence proves
// the handler parses the request even when no zod schema guards it, so an interior
// schema must not stand in for the request contract when one of these exists.
const REQUEST_READ_RE =
  /const\s*\{[^}]*\}\s*=\s*(?:await\s+)?(?:req|request)\.(?:body|query|json\s*\(\s*\))/

function hasRequestRead(handlerBodyText: string): boolean {
  return REQUEST_READ_RE.test(handlerBodyText)
}

// A one-hop request-derived local — `const body = await req.json()`, `const b = req.body`,
// `let q = req.query`, optionally typed (`const body: Raw = await req.json()`), `var`
// forms too. A parse-site whose argument is exactly one of these bare identifiers traces
// to the request just as directly as writing `req.body` inline — it *is* the request
// read, one variable removed. A member access off it (`body.foo`) is NOT one-hop: that is
// a derived sub-object, same as the already-interior `request.body.items` case, so only
// the bare identifier itself qualifies, never `X.member`.
const ONE_HOP_REQUEST_VAR_RE =
  /\b(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:await\s+)?(?:req|request)\.(?:(body)|(query)|json\s*\(\s*\))/g

// Map of one-hop request variable name -> the location it traces to, scanned once per
// handler so both the "is any site request-bound" check and each site's own location
// can consult it.
function collectOneHopRequestVars(handlerBodyText: string): Map<string, InputField['location']> {
  const vars = new Map<string, InputField['location']>()
  for (const m of handlerBodyText.matchAll(ONE_HOP_REQUEST_VAR_RE)) {
    const [, name, , isQuery] = m
    // Unmatched `isBody`/`isQuery` groups mean the `req.json()` alternative fired —
    // that is a body read too, same as the `body` group matching.
    vars.set(name, isQuery ? 'query' : 'body')
  }
  return vars
}

// A parse argument is request-bound either textually (see `REQUEST_BOUND_ARG_RE`) or
// because it is exactly a one-hop request variable's bare name.
function isRequestBoundArg(
  argsText: string,
  oneHopVars: Map<string, InputField['location']>,
): boolean {
  return REQUEST_BOUND_ARG_RE.test(argsText) || oneHopVars.has(argsText.trim())
}

// The location a parse argument resolves to: a one-hop request variable carries its own
// recorded location (a query-sourced local must not default to 'body'); otherwise fall
// back to the textual classifier.
function locationForArg(
  argsText: string,
  oneHopVars: Map<string, InputField['location']>,
): InputField['location'] {
  return oneHopVars.get(argsText.trim()) ?? locationFromArgsText(argsText)
}

// A single scratch, in-memory project reused across calls to re-parse handler
// body text into a real AST fragment (see `inlineZodParseSites`). The same
// filename is overwritten each time, so nothing accumulates.
let scratchProject: Project | undefined

function scratch(): Project {
  scratchProject ??= new Project({ useInMemoryFileSystem: true })
  return scratchProject
}

// Sites where `.parse(...)`/`.safeParse(...)` is called directly on an inline
// schema expression (e.g. `z.object({...})`) rather than a named identifier.
// `handlerBodyText` is plain text, not a node from `sourceFile`'s own AST, so
// there is no existing tree to walk — it is re-parsed here just enough to get
// real Expression nodes, which are then handed to `fieldsFromInitializer`,
// the same resolver the named-schema path uses.
function inlineZodParseSites(
  handlerBodyText: string,
): Array<{ receiver: Expression; sf: SourceFile; argsText: string }> {
  const sf = scratch().createSourceFile(
    '__inline_zod_scratch__.ts',
    `async function __h__() { ${handlerBodyText} }`,
    { overwrite: true },
  )
  const sites: Array<{ receiver: Expression; sf: SourceFile; argsText: string }> = []
  sf.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return
    const callee = node.getExpression()
    if (!Node.isPropertyAccessExpression(callee)) return
    if (callee.getName() !== 'parse' && callee.getName() !== 'safeParse') return
    const receiver = callee.getExpression()
    // A bare identifier (`schema.parse(...)`) is the named-schema path above.
    if (Node.isIdentifier(receiver)) return
    sites.push({
      receiver,
      sf,
      argsText: node
        .getArguments()
        .map((a) => a.getText())
        .join(', '),
    })
  })
  return sites
}

// Calls that receive a zod schema as an argument — the `parseRequest(req, schema)`
// wrapper idiom (umami's). The schema is validated *inside* the wrapper, so it
// never appears as a `.parse`/`.safeParse` receiver in the handler and the direct
// detectors above miss it entirely. Any argument that is a named schema (resolved
// locally first, then module-level/imported) or an inline `z.object` literal is
// pulled in. The wrapper hides whether the schema guards the query or the body, so
// location is decided by the caller's HTTP method, not by the call text.
function wrapperSchemaSites(
  handlerBodyText: string,
  sourceFile: SourceFile,
): Array<{ fields: RawField[]; fnName: string }> {
  const sf = scratch().createSourceFile(
    '__wrapper_schema_scratch__.ts',
    `async function __h__() { ${handlerBodyText} }`,
    { overwrite: true },
  )
  const sites: Array<{ fields: RawField[]; fnName: string }> = []
  sf.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return
    const callee = node.getExpression()
    // A `.parse`/`.safeParse` call is owned by the direct/inline paths; skipping
    // it also guarantees an inline `z.object` literal that is itself a parse
    // receiver is never double-counted here (it is not an argument anyway).
    if (Node.isPropertyAccessExpression(callee)) {
      const m = callee.getName()
      if (m === 'parse' || m === 'safeParse') return
    }
    const fnName = callee.getText()
    for (const arg of node.getArguments()) {
      let fields: RawField[] = []
      if (Node.isIdentifier(arg)) {
        // A schema declared inside the handler body wins (umami's idiom). It is a
        // *nested* declaration, which `SourceFile.getVariableDeclaration` (used by
        // `resolveSchema`) does not see — so search the scratch AST directly first,
        // then fall back to a module-level/imported schema in the real file.
        const local = findNestedDecl(sf, arg.getText())
        if (local) fields = fieldsFromInitializer(local.getInitializer(), sf, 0, new Set())
        if (fields.length === 0) fields = resolveSchema(arg.getText(), sourceFile, 0, new Set())
      } else if (Node.isCallExpression(arg)) {
        fields = fieldsFromInitializer(arg, sf, 0, new Set())
      }
      if (fields.length > 0) sites.push({ fields, fnName })
    }
  })
  return sites
}

// `const { a, b: localB, c = 1 } = await req.json()` → body fields named
// after the source key (`a`, `b`, `c`), types unknown (no schema to type
// them), required (no way to tell optionality apart from a default).
const REQ_JSON_DESTRUCTURE_RE = /const\s*\{([^}]+)\}\s*=\s*await\s+(?:req|request)\.json\(\)/g

function reqJsonDestructureFields(handlerBodyText: string): InputField[] {
  const fields: InputField[] = []
  const seen = new Set<string>()
  for (const m of handlerBodyText.matchAll(REQ_JSON_DESTRUCTURE_RE)) {
    for (const raw of m[1].split(',')) {
      // Drop a default first (`x = 1`), then an alias (`orig: local`) — the
      // original key name is whatever remains before the colon.
      const name = raw.split(':')[0].split('=')[0].trim()
      if (/^\w+$/.test(name) && !seen.has(name)) {
        seen.add(name)
        fields.push({ name, type: 'unknown', required: true, location: 'body' })
      }
    }
  }
  return fields
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
  method?: string,
): InputField[] {
  const used = [...handlerBodyText.matchAll(/\b(\w+)\.(?:safeParse|parse)\(/g)].map((m) => m[1])
  const result: InputField[] = []
  const names = new Set<string>()

  const inlineSites = inlineZodParseSites(handlerBodyText)
  const wrapperSites = wrapperSchemaSites(handlerBodyText, sourceFile)
  const oneHopVars = collectOneHopRequestVars(handlerBodyText)

  // Does ANY site in this handler parse the request itself — a named or inline
  // schema whose parse argument traces to the request body/query (directly, or one
  // hop through a `const body = await req.json()`-style local), a wrapper that
  // receives the request, or a bare `const {..} = req.body/req.query/req.json()`
  // read? When one exists, an interior schema (one validating a derived/nested
  // value) must NOT masquerade as the request contract: it is demoted so the
  // request-parsing site — or the body/query fallback below — supplies the fields
  // agents actually send. When NONE exists, the interior schema is the only signal
  // there is, so it is kept exactly as before (never regress an interior-only app).
  const namedRequestBound = used.some(
    (n) => n !== 'JSON' && isRequestBoundArg(argsForParseCall(handlerBodyText, n), oneHopVars),
  )
  const inlineRequestBound = inlineSites.some((s) => isRequestBoundArg(s.argsText, oneHopVars))
  const requestParsingPresent =
    namedRequestBound ||
    inlineRequestBound ||
    wrapperSites.length > 0 ||
    hasRequestRead(handlerBodyText)

  for (const schemaName of used) {
    if (schemaName === 'JSON') continue
    const fields = resolveSchema(schemaName, sourceFile, 0, new Set())
    if (fields.length === 0) continue
    const argsText = argsForParseCall(handlerBodyText, schemaName)
    // An interior schema (its parse argument is not the request, including one hop
    // through a request-derived local) yields to any request-parsing site in the
    // same handler and is skipped entirely here.
    if (requestParsingPresent && !isRequestBoundArg(argsText, oneHopVars)) continue
    const location = locationForArg(argsText, oneHopVars)
    // Multi-schema handlers merge; the first declaration of a name wins.
    for (const f of fields) {
      if (names.has(f.name)) continue
      names.add(f.name)
      result.push({ ...f, location })
    }
  }

  // Inline schema literals passed straight to `.parse`/`.safeParse` (no named
  // declaration to resolve via `resolveSchema`): rank below named schemas,
  // above the text-only fallbacks below.
  for (const { receiver, sf, argsText } of inlineSites) {
    const fields = fieldsFromInitializer(receiver, sf, 0, new Set())
    if (fields.length === 0) continue
    const location = locationForArg(argsText, oneHopVars)
    let added = false
    for (const f of fields) {
      if (names.has(f.name)) continue
      names.add(f.name)
      result.push({ ...f, location })
      added = true
    }
    if (added) evidence?.push('inline zod object schema')
  }

  // Wrapper-call schemas (`parseRequest(req, schema)`): ranks below both direct
  // zod paths (a schema also parsed directly keeps that location), above the
  // text-only fallbacks. The wrapper hides query-vs-body, so a GET reads query
  // and every other method (or an unknown method) reads a body.
  const wrapperLocation: InputField['location'] = method === 'GET' ? 'query' : 'body'
  for (const { fields, fnName } of wrapperSites) {
    let added = false
    for (const f of fields) {
      if (names.has(f.name)) continue
      names.add(f.name)
      result.push({ ...f, location: wrapperLocation })
      added = true
    }
    if (added) evidence?.push(`schema via wrapper call ${fnName}`)
  }

  // `const { a, b } = await req.json()` destructuring: ranks below both zod
  // paths (they carry real types/required), above searchParams and the bare
  // fallback.
  const jsonDestructure = reqJsonDestructureFields(handlerBodyText).filter(
    (f) => !names.has(f.name),
  )
  if (jsonDestructure.length > 0) {
    for (const f of jsonDestructure) {
      names.add(f.name)
      result.push(f)
    }
    evidence?.push('body params via req.json destructure')
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
