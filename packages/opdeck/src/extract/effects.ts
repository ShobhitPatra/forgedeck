import {
  Node,
  type SourceFile,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
} from 'ts-morph'
import type { Effect } from '../ir/types.js'

type FnLike = FunctionDeclaration | ArrowFunction | FunctionExpression

const WRITE_OPS = ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']
const READ_OPS = ['findMany', 'findUnique', 'findFirst', 'count', 'aggregate', 'groupBy']
const WRITE_SET = new Set(WRITE_OPS)
// `<client>[.client].<model>.<op>()` — the optional `.client` segment recognises
// the wrapped-accessor idiom (`prisma.client.document.findMany`, the umami shape)
// identically to a direct call; group 2 preserves the written `.client` so the
// evidence keeps the source form. The no-sf regex fallback is thus effectively
// `(?:prisma|db)(?:\.client)?\.` once isDBClient gates the base name.
const CLIENT_OP = new RegExp(
  `\\b(\\w+)((?:\\.client)?)\\.(\\w+)\\.(${[...WRITE_OPS, ...READ_OPS].join('|')})\\b`,
  'g',
)

// Following a call three hops deep keeps the trace bounded on real service layers
// while still reaching the writes that sit one or two indirections from a handler.
const MAX_DEPTH = 3

// Names whose direct call carries no traceable effect: framework response/request
// helpers, globals and language keywords. Anything here is neither followed nor
// counted as a conservative unresolved call.
const DENYLIST = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'function',
  'typeof',
  'await',
  'async',
  'do',
  'else',
  'super',
  'this',
  'void',
  'yield',
  'delete',
  'instanceof',
  'new',
  'throw',
  'console',
  'res',
  'req',
  'next',
  'NextResponse',
  'Response',
  'Request',
  'JSON',
  'Object',
  'Array',
  'Promise',
  'Number',
  'String',
  'Boolean',
  'Date',
  'Math',
  'RegExp',
  'Map',
  'Set',
  'WeakMap',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'fetch',
  'require',
  'URL',
  'URLSearchParams',
  'Error',
  'TypeError',
  'structuredClone',
  'redirect',
  'notFound',
  'revalidatePath',
  'revalidateTag',
  'cookies',
  'headers',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'atob',
  'btoa',
  'encodeURIComponent',
  'decodeURIComponent',
])

// Observability/telemetry loggers (papermark's `log`, Sentry's `captureException`/
// `captureMessage`) post diagnostics to a Slack/Sentry webhook, not user data. The
// scanner still FOLLOWS such a call into its subtree as normal — a real DB write
// hiding behind a telemetry name (e.g. an audit-log `prisma.auditLog.create` before
// the Slack POST) must still count and still demote a GET to `write` — but the
// fire-and-forget webhook/external-fetch signal detected inside that subtree
// (`log -> postJsonWithTimeout -> fetch`) is suppressed so it alone cannot demote a
// read GET. This is the exact chain that demoted ~16 read GETs in papermark to
// `enabled:false`; the call is recorded as `telemetry ... webhook suppressed,
// unverified` so the side effect stays auditable in evidence. Only bare direct
// calls match (`log(`); a data write like `prisma.log.create` is a property-access
// client op and is unaffected. Non-GET methods are already write by default, so
// this never unmasks (or hides) a genuine mutation there. Scoped to Sentry's pair
// plus the generic `log` name — names that never touch the app DB by convention;
// deliberately NOT `logger`/`logError`/`logEvent` (unevidenced beyond `log` itself).
const TELEMETRY_LOGGERS = new Set(['log', 'captureException', 'captureMessage'])

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

interface Acc {
  writes: Set<string>
  reads: Set<string>
  external: Set<string>
  evidence: string[]
  unresolved: boolean
  getMode: boolean
  // Set while scanning inside a telemetry logger's resolved subtree (GET mode
  // only); scoped to that subtree by save/restore around the recursive `scan`
  // call, so it never leaks to sibling calls once the subtree returns.
  suppressWebhook: boolean
}

// `prisma.$transaction(async (tx) => ...)` — the callback param is a scoped DB
// client; recognise it by shape so `tx.order.create` counts as a write.
function collectTxParams(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(/\$transaction\s*\(\s*(?:async\s*)?\(\s*(\w+)/g)) out.add(m[1])
  return out
}

// An identifier used as `x.<model>.<op>()` is a DB client when it is the
// conventional prisma/db alias, a transaction callback param, or its resolved
// declaration type is a PrismaClient.
function isDBClient(name: string, sf: SourceFile | undefined, txParams: Set<string>): boolean {
  if (name === 'prisma' || name === 'db') return true
  if (txParams.has(name)) return true
  if (!sf) return false
  try {
    const vd = sf.getVariableDeclaration(name)
    if (vd && vd.getType().getText().includes('PrismaClient')) return true
    const id = sf.getFirstDescendant((n) => Node.isIdentifier(n) && n.getText() === name)
    if (id && id.getType().getText().includes('PrismaClient')) return true
  } catch {
    // type resolution is best effort; a failure just means no upgrade
  }
  return false
}

// Money, email, storage and outbound-webhook side effects are the ones reviewers
// and agents most need surfaced; detect them by import-independent name patterns.
function detectExternal(text: string): { tag: string; snippet: string }[] {
  const out: { tag: string; snippet: string }[] = []
  const stripe = text.match(/\bstripe\.\w+/)
  if (stripe) out.push({ tag: 'stripe', snippet: stripe[0] })
  const email = text.match(/\b(?:resend|sendgrid)\.\w+|\bnodemailer\b|\bsendEmail\s*\(/)
  if (email) out.push({ tag: 'email', snippet: email[0].replace(/\s*\($/, '') })
  const storage = text.match(/\bs3\.\w+|\bupload\s*\(/)
  if (storage) out.push({ tag: 'storage', snippet: storage[0].replace(/\s*\($/, '') })
  if (/\bfetch\s*\(/.test(text) && /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i.test(text))
    out.push({ tag: 'webhook', snippet: 'fetch' })
  return out
}

// Direct call identifiers `name(` (not property accesses `x.name(`), remembering
// whether each was awaited so unresolved awaited calls can be flagged.
function directCalls(text: string): { awaited: boolean; name: string }[] {
  const out: { awaited: boolean; name: string }[] = []
  for (const m of text.matchAll(/(?:^|[^.\w$])(await\s+)?([A-Za-z_$][\w$]*)\s*\(/g))
    out.push({ awaited: !!m[1], name: m[2] })
  return out
}

function asFnLike(node: Node | undefined): FnLike | undefined {
  if (!node) return undefined
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node)
  )
    return node
  return undefined
}

function localFn(sf: SourceFile, name: string): FnLike | undefined {
  const fn = sf.getFunction(name)
  if (fn) return fn
  return asFnLike(sf.getVariableDeclaration(name)?.getInitializer())
}

function exportedFn(sf: SourceFile, name: string): FnLike | undefined {
  const fn = sf.getFunction(name)
  if (fn?.isExported()) return fn
  const vd = sf.getVariableDeclaration(name)
  if (vd?.isExported()) return asFnLike(vd.getInitializer())
  return undefined
}

// Resolve a called name to a function declaration/const-arrow in a project file:
// local first, then across the source file's named/default imports.
function resolveCall(sf: SourceFile, name: string): FnLike | undefined {
  const local = localFn(sf, name)
  if (local) return local
  for (const imp of sf.getImportDeclarations()) {
    const mod = imp.getModuleSpecifierSourceFile()
    if (!mod) continue
    for (const spec of imp.getNamedImports()) {
      const alias = spec.getAliasNode()?.getText()
      if (name === (alias ?? spec.getName())) {
        const r = exportedFn(mod, spec.getName())
        if (r) return r
      }
    }
    if (imp.getDefaultImport()?.getText() === name) {
      const df = mod.getFunctions().find((f) => f.isDefaultExport())
      if (df) return df
    }
  }
  return undefined
}

function scan(
  text: string,
  sf: SourceFile | undefined,
  chain: string[],
  depth: number,
  visited: Set<string>,
  acc: Acc,
): void {
  const prefix = chain.length ? chain.join(' -> ') + ' -> ' : ''
  const txParams = collectTxParams(text)

  for (const m of text.matchAll(CLIENT_OP)) {
    const [, client, clientSuffix, model, op] = m
    if (!isDBClient(client, sf, txParams)) continue
    const isWrite = WRITE_SET.has(op)
    ;(isWrite ? acc.writes : acc.reads).add(cap(model))
    acc.evidence.push(
      `effect ${isWrite ? 'write' : 'read'} via ${prefix}${client}${clientSuffix}.${model}.${op}`,
    )
  }

  for (const ext of detectExternal(text)) {
    // Within a telemetry logger's own subtree the fire-and-forget webhook POST is
    // the exact signal FINDING 1/2C relax around; it is dropped here (not counted,
    // not re-evidenced) rather than tagged a write — the `telemetry call ...
    // webhook suppressed, unverified` evidence pushed at the call site already
    // documents the suppression. Non-webhook external taxonomy (stripe/email/
    // storage) is unaffected and still counts even inside the subtree.
    if (ext.tag === 'webhook' && acc.suppressWebhook) continue
    acc.external.add(ext.tag)
    acc.evidence.push(`effect write via ${prefix}${ext.snippet} (external ${ext.tag})`)
  }

  if (!sf || depth >= MAX_DEPTH) return

  for (const { awaited, name } of directCalls(text)) {
    if (DENYLIST.has(name)) continue
    // Under the GET relaxation a telemetry/observability logger IS followed into its
    // subtree as normal (a real DB write hiding behind the name must still count and
    // demote the GET); only its diagnostics webhook (fire-and-forget Slack/Sentry
    // POST) is suppressed once inside, via `acc.suppressWebhook`. The call site is
    // still marked in evidence so the effect stays auditable either way.
    const isTelemetry = acc.getMode && TELEMETRY_LOGGERS.has(name)
    if (isTelemetry)
      acc.evidence.push(`telemetry call ${prefix}${name}, webhook suppressed, unverified`)
    const fn = resolveCall(sf, name)
    if (fn) {
      const key = `${fn.getSourceFile().getFilePath()}:${fn.getStart()}`
      if (visited.has(key)) continue
      visited.add(key)
      const body = fn.getBody()?.getText() ?? fn.getText()
      const prevSuppress = acc.suppressWebhook
      if (isTelemetry) acc.suppressWebhook = true
      scan(body, fn.getSourceFile(), [...chain, name], depth + 1, visited, acc)
      acc.suppressWebhook = prevSuppress
    } else if (awaited && !isTelemetry) {
      // Under the bounded GET relaxation the call is recorded as `unverified` (it
      // does not force write for a GET with no other write signal); elsewhere it
      // stays the conservative write signal. Either way the trail is preserved.
      acc.evidence.push(`unresolved call ${name}, ${acc.getMode ? 'unverified' : 'conservative'}`)
      acc.unresolved = true
    }
  }
}

function resolveEffect(acc: Acc, method: string | undefined): Effect {
  if (acc.writes.size > 0 || acc.external.size > 0) return 'write'
  const m = method?.toUpperCase()
  if (m && m !== 'GET') return 'write'
  if (acc.reads.size > 0) return 'read'
  // Bounded GET relaxation (deliberate, signed-off amendment to uncertainty-means-
  // write): an HTTP GET with no write signal anywhere in the resolved graph — no
  // client writes, no external taxonomy hit — reads even when it also contains an
  // unresolved call. HTTP GET carries read semantics; a GET that secretly mutates
  // is an app defect the compiler cannot own, and every unresolved call is still
  // recorded in evidence as `unverified` so the auditability is not lost. Server
  // actions and non-GET methods (handled above) keep the conservative default.
  if (m === 'GET') return 'read'
  // Method absent (e.g. server actions): an unresolved awaited call, or no signal
  // at all, stays a conservative write.
  return 'write'
}

// Classify a handler (or code segment) into a data effect, the entities it
// touches and an ordered evidence trail. With a `sf` the scan resolves DB client
// types and follows calls into project files (depth 3); without one it falls back
// to regex-only detection over prisma/db aliases plus the external taxonomy.
export function classifyEffect(
  bodyText: string,
  opts: { method?: string; sf?: SourceFile; depth?: number },
): { effect: Effect; entitiesTouched: string[]; evidence: string[]; external: string[] } {
  const acc: Acc = {
    writes: new Set(),
    reads: new Set(),
    external: new Set(),
    evidence: [],
    unresolved: false,
    getMode: opts.method?.toUpperCase() === 'GET',
    suppressWebhook: false,
  }
  scan(bodyText, opts.sf, [], opts.depth ?? 0, new Set(), acc)
  return {
    effect: resolveEffect(acc, opts.method),
    entitiesTouched: [...new Set([...acc.writes, ...acc.reads])],
    evidence: acc.evidence,
    external: [...acc.external],
  }
}
