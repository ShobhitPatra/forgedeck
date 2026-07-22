import {
  validateIR,
  type ActionIR,
  type CoverageItem,
  type EntityIR,
  type InputField,
  type SemanticIR,
} from './ir/types.js'
import { loadProject } from './load/project.js'
import { extractEntitiesWithSource } from './extract/entities.js'
import { extractRoutes } from './extract/routes.js'
import { extractServerActions } from './extract/actions.js'
import { extractPagesApi } from './extract/pagesApi.js'
import { loadMiddlewareMatchers } from './extract/auth.js'
import { assembleWorkflows } from './extract/annotate.js'
import { loadConfig } from './config/load.js'
import { levenshtein } from './config/schema.js'
import { computeScopeVerdict } from './ir/verdict.js'

// Re-exported so callers (and the task-6 brief's own test sketch) can reach the
// pure verdict function as `import { computeScopeVerdict } from './compile.js'`
// without pulling in the rest of compile's machinery. The implementation lives
// in `./ir/verdict.js` because `./ir/types.ts`'s `validateIR` also needs it (to
// backfill a verdict on pre-verdict IR shapes) — putting it in compile.ts would
// force types.ts into a circular value-import on compile.ts.
export { computeScopeVerdict }

// Minimal glob → RegExp for `exclude` patterns. Supports only `**` (any chars,
// crossing `/`) and `*` (any chars except `/`) — deliberately no braces, negation,
// or character classes (a config exclude is a fence, not a query language). Anchored
// full-match against a project-relative POSIX path.
export function globToRegExp(glob: string): RegExp {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*'
        i++
      } else {
        out += '[^/]*'
      }
    } else if (/[.+?^${}()|[\]\\]/.test(c)) {
      out += '\\' + c
    } else {
      out += c
    }
  }
  return new RegExp(`^${out}$`)
}

// True when a project-relative path matches any of the exclude globs.
function isExcluded(rel: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(rel))
}

// Nearest extracted action name within a small edit distance — powers the
// did-you-mean on an allowlisted name that matched no action.
function nearestActionName(name: string, actions: ActionIR[]): string | undefined {
  let best: string | undefined
  let bestDist = Infinity
  for (const a of actions) {
    const d = levenshtein(name.toLowerCase(), a.name.toLowerCase())
    if (d < bestDist) {
      bestDist = d
      best = a.name
    }
  }
  const threshold = Math.max(2, Math.floor(name.length / 3))
  return best !== undefined && bestDist <= threshold ? best : undefined
}

// Apply the config allowlist AFTER collision resolution (names are final). Each
// allowlisted name that maps to a non-read action is deliberately enabled with a
// config-allowlist receipt. Reads are already enabled by default (no-op). Names
// matching no action are skip-logged with a near-match suggestion. Returns coverage
// notes for the unknown names.
export function applyAllowlist(
  actions: ActionIR[],
  enabledActions: string[],
  environment: string,
): CoverageItem[] {
  const skips: CoverageItem[] = []
  const byName = new Map(actions.map((a) => [a.name, a]))
  for (const name of enabledActions) {
    const action = byName.get(name)
    if (!action) {
      const near = nearestActionName(name, actions)
      skips.push({
        file: 'forgedeck.config.ts',
        reason: near
          ? `${name} in allowlist but not found — did you mean '${near}'?`
          : `${name} in allowlist but not found`,
      })
      continue
    }
    if (action.effect === 'read') continue
    action.enabled = true
    action.enabledBy = 'config-allowlist'
    action.evidence.push(`enabled via config allowlist (${environment})`)
  }
  return skips
}

function surfaceSuffix(kind: ActionIR['kind']): string {
  return kind === 'route' ? '_app' : kind === 'pages-api' ? '_pages' : '_action'
}

// Tool names must be globally unique and stable (agents and allowlists key on
// them). When two surfaces yield the same name, the earliest by sourceFile keeps
// it; the rest get a deterministic surface suffix, then a numeric suffix if that
// still collides. Every rename is skip-logged. Mutates action names in place.
function resolveCollisions(actions: ActionIR[]): CoverageItem[] {
  const skips: CoverageItem[] = []
  const groups = new Map<string, ActionIR[]>()
  for (const a of actions) {
    const g = groups.get(a.name)
    if (g) g.push(a)
    else groups.set(a.name, [a])
  }

  const used = new Set<string>()
  const toRename: ActionIR[] = []
  for (const [name, group] of groups) {
    used.add(name)
    if (group.length === 1) continue
    group.sort((a, b) => (a.sourceFile < b.sourceFile ? -1 : a.sourceFile > b.sourceFile ? 1 : 0))
    for (const a of group.slice(1)) toRename.push(a)
  }

  toRename.sort((a, b) =>
    a.name !== b.name ? (a.name < b.name ? -1 : 1) : a.sourceFile < b.sourceFile ? -1 : 1,
  )
  for (const a of toRename) {
    const original = a.name
    let candidate = original + surfaceSuffix(a.kind)
    let n = 2
    while (used.has(candidate)) {
      candidate = `${original}${surfaceSuffix(a.kind)}_${n}`
      n++
    }
    used.add(candidate)
    a.name = candidate
    skips.push({
      file: a.sourceFile,
      reason: `action name collision resolved: ${original} -> ${candidate}`,
    })
  }
  return skips
}

// Prisma scalar type -> InputField type. The single place an app already
// declares concrete field types, recovered for inputs the zod layer left unknown.
const PRISMA_TYPE_MAP: Record<string, InputField['type']> = {
  String: 'string',
  Int: 'number',
  Float: 'number',
  Decimal: 'number',
  Boolean: 'boolean',
  DateTime: 'string',
}

// Post-pass: an `unknown` input whose name matches (case-insensitively) a field
// on one of the action's touched entities is typed from the Prisma type map,
// with an evidence receipt. Mutates inputs and evidence in place.
export function applyPrismaTypes(actions: ActionIR[], entities: EntityIR[]): void {
  const byName = new Map(entities.map((e) => [e.name, e]))
  for (const action of actions) {
    for (const input of action.inputs) {
      if (input.type !== 'unknown') continue
      for (const entName of action.entitiesTouched) {
        const field = byName
          .get(entName)
          ?.fields.find((f) => f.name.toLowerCase() === input.name.toLowerCase())
        if (!field) continue
        const mapped = PRISMA_TYPE_MAP[field.type.replace(/\[\]$/, '')]
        if (!mapped) continue
        input.type = mapped
        action.evidence.push(`input ${input.name} typed from prisma ${entName}.${field.name}`)
        break
      }
    }
  }
}

export async function compile(projectDir: string): Promise<SemanticIR> {
  const config = await loadConfig(projectDir)
  const loaded = loadProject(projectDir)

  // Exclude globs are applied BEFORE the extraction surface scan: a matched source
  // file is removed from the project so no surface is ever derived from it, and each
  // removal is skip-logged. This is the fence — a whole file is out, deliberately.
  const excludeSkips: CoverageItem[] = []
  if (config?.exclude.length) {
    const patterns = config.exclude.map(globToRegExp)
    for (const sf of loaded.project.getSourceFiles()) {
      const rel = loaded.relPath(sf.getFilePath())
      if (!isExcluded(rel, patterns)) continue
      excludeSkips.push({ file: rel, reason: 'excluded by config' })
      loaded.project.removeSourceFile(sf)
    }
  }

  const { entities, workspaceNote } = extractEntitiesWithSource(loaded.rootDir)
  const matchers = loadMiddlewareMatchers(loaded)
  const routes = extractRoutes(loaded, matchers)
  const serverActions = extractServerActions(loaded)
  const pagesApi = extractPagesApi(loaded, matchers)
  const actions = [...routes.actions, ...serverActions.actions, ...pagesApi.actions]
  const collisionSkips = resolveCollisions(actions)
  applyPrismaTypes(actions, entities)

  // Allowlist runs AFTER collision resolution so it keys on final tool names.
  const allowlistSkips = config
    ? applyAllowlist(actions, config.enabledActions, config.environment)
    : []

  // Workflows are assembled AFTER collision resolution so each step records the
  // action's final (possibly renamed) tool name.
  const { workflows, warnings: workflowWarnings } = assembleWorkflows([
    ...routes.workflowBindings,
    ...serverActions.workflowBindings,
    ...pagesApi.workflowBindings,
  ])

  // Dormant environment blocks are surfaced so a config author sees which of their
  // present-but-unapplied environments this build ignored.
  const environmentSkips: CoverageItem[] = (config?.unappliedEnvironments ?? []).map((name) => ({
    file: 'forgedeck.config.ts',
    reason: `environment block ${name} present, not active`,
  }))

  const skipped: CoverageItem[] = [
    ...excludeSkips,
    ...routes.skipped,
    ...serverActions.skipped,
    ...pagesApi.skipped,
    ...collisionSkips,
    ...allowlistSkips,
    ...environmentSkips,
    ...workflowWarnings,
    ...(workspaceNote ? [workspaceNote] : []),
  ]

  return validateIR({
    app: { name: loaded.appName, framework: loaded.framework },
    entities,
    actions,
    workflows,
    coverage: {
      extracted: actions.length,
      skipped,
      ...(config ? { environment: config.resolvedEnvLine } : {}),
      verdict: computeScopeVerdict(actions.length, skipped),
    },
  })
}
