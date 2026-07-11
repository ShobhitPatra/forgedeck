import { validateIR, type ActionIR, type CoverageItem, type SemanticIR } from './ir/types.js'
import { loadProject } from './load/project.js'
import { extractEntities } from './extract/entities.js'
import { extractRoutes } from './extract/routes.js'
import { extractServerActions } from './extract/actions.js'
import { extractPagesApi } from './extract/pagesApi.js'

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

export function compile(projectDir: string): SemanticIR {
  const loaded = loadProject(projectDir)
  const entities = extractEntities(loaded.rootDir)
  const routes = extractRoutes(loaded)
  const serverActions = extractServerActions(loaded)
  const pagesApi = extractPagesApi(loaded)
  const actions = [...routes.actions, ...serverActions.actions, ...pagesApi.actions]
  const collisionSkips = resolveCollisions(actions)

  return validateIR({
    app: { name: loaded.appName, framework: loaded.framework },
    entities,
    actions,
    coverage: {
      extracted: actions.length,
      skipped: [
        ...routes.skipped,
        ...serverActions.skipped,
        ...pagesApi.skipped,
        ...collisionSkips,
      ],
    },
  })
}
