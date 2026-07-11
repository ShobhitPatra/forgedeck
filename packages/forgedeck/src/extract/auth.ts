import { Node, type SourceFile } from 'ts-morph'
import type { AuthRequirement } from '../ir/types.js'
import type { LoadedProject } from '../load/project.js'

export interface AuthResult {
  auth: AuthRequirement
  evidence: string[]
}

export interface Matcher {
  pattern: string
  regex: RegExp
}

// Session idioms and the module patterns that legitimise them. Presence of the
// call alone is a strong signal; when a source file is available we additionally
// require the name to be imported from an auth-shaped module so a locally defined
// same-named function does not masquerade as authentication.
const SESSION_IDIOMS: { name: string; source: RegExp }[] = [
  { name: 'getServerSession', source: /next-auth/ },
  { name: 'auth', source: /next-auth|@clerk|(^|\/|@)auth$/ },
  { name: 'currentUser', source: /@clerk|clerk/ },
  { name: 'getUser', source: /supabase/ },
]

// A named/default import of `name` whose module specifier matches `source`.
function importedFrom(sf: SourceFile, name: string, source: RegExp): boolean {
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue()
    if (!source.test(spec)) continue
    if (imp.getDefaultImport()?.getText() === name) return true
    for (const named of imp.getNamedImports()) {
      const alias = named.getAliasNode()?.getText()
      if ((alias ?? named.getName()) === name) return true
    }
  }
  return false
}

// A session idiom used in the handler body — with an import-source check when a
// source file is available — makes the handler `required`. Guarded or unguarded,
// the posture is conservative: an authenticated read of the caller's identity is
// evidence the surface expects credentials.
export function detectHandlerAuth(bodyText: string, sf?: SourceFile): AuthResult {
  for (const idiom of SESSION_IDIOMS) {
    if (!new RegExp(`\\b${idiom.name}\\s*\\(`).test(bodyText)) continue
    if (sf && !importedFrom(sf, idiom.name, idiom.source)) continue
    return { auth: 'required', evidence: [`auth required via ${idiom.name} in handler`] }
  }
  return { auth: 'unknown', evidence: [] }
}

// A default-export wrapper whose name reads as authentication (`withAuth`,
// `withTeamApi`, `withAdmin`, ...) protects everything it wraps.
const WRAPPER_AUTH = /^with.*[Aa]uth|^with(Team|User|Session|Admin)/

export function detectWrapperAuth(wrapperName: string): AuthResult {
  if (WRAPPER_AUTH.test(wrapperName))
    return { auth: 'required', evidence: [`auth required via wrapper ${wrapperName}`] }
  return { auth: 'unknown', evidence: [] }
}

// Next matcher syntax to an anchored regex: a `:name*` catch-all becomes `.*`, a
// plain `:name` param becomes a single segment, literal segments stay literal.
// Sentinels stand in for the param tokens across the literal-escaping step.
function matcherToRegex(pattern: string): RegExp {
  const catchAll = String.fromCharCode(0)
  const segment = String.fromCharCode(1)
  const source = pattern
    .replace(/:\w+\*/g, catchAll)
    .replace(/:\w+/g, segment)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .split(catchAll)
    .join('.*')
    .split(segment)
    .join('[^/]+')
  return new RegExp(`^${source}$`)
}

// Parse `export const config = { matcher: [...] }` out of the project's
// middleware file(s). String-literal patterns only; anything dynamic is skipped
// (a missing matcher just means no matcher-derived protection, never a false none).
export function loadMiddlewareMatchers(loaded: LoadedProject): Matcher[] {
  const matchers: Matcher[] = []
  for (const sf of loaded.project.getSourceFiles()) {
    if (!/(^|\/)middleware\.tsx?$/.test(loaded.relPath(sf.getFilePath()))) continue
    const config = sf.getVariableDeclaration('config')?.getInitializer()
    if (!config || !Node.isObjectLiteralExpression(config)) continue
    const matcherProp = config.getProperty('matcher')
    if (!matcherProp || !Node.isPropertyAssignment(matcherProp)) continue
    const init = matcherProp.getInitializer()
    const elements =
      init && Node.isArrayLiteralExpression(init) ? init.getElements() : init ? [init] : []
    for (const el of elements) {
      if (!Node.isStringLiteral(el)) continue
      const pattern = el.getLiteralValue()
      matchers.push({ pattern, regex: matcherToRegex(pattern) })
    }
  }
  return matchers
}

// The first matcher pattern that covers `path`, or undefined.
export function matcherCovers(matchers: Matcher[], path: string): string | undefined {
  return matchers.find((m) => m.regex.test(path))?.pattern
}

// Resolution order (contract rule 4): a handler-level `required` wins; otherwise
// middleware coverage of the route path makes it `required`; otherwise `unknown`.
// `none` is never derived in 2B — absence of evidence must not publish an endpoint.
export function resolveAuth(
  handler: AuthResult,
  path: string | undefined,
  matchers: Matcher[],
): AuthResult {
  if (handler.auth === 'required') return handler
  if (path) {
    const covered = matcherCovers(matchers, path)
    if (covered)
      return { auth: 'required', evidence: [`auth required via middleware matcher ${covered}`] }
  }
  return { auth: 'unknown', evidence: [] }
}

// NextAuth/Clerk catch-all handlers (`pages/api/auth/[...nextauth].ts`,
// `app/api/auth/[...clerk]/route.ts`) are auth infrastructure, not app actions.
export function isAuthPlumbingRoute(rel: string): boolean {
  return /(^|\/)auth\/\[\.\.\.[^/]*\](\/route)?\.tsx?$/.test(rel)
}
