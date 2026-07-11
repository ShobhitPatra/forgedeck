import { validateIR, type SemanticIR } from './ir/types.js'
import { loadProject } from './load/project.js'
import { extractEntities } from './extract/entities.js'
import { extractRoutes } from './extract/routes.js'
import { extractServerActions } from './extract/actions.js'

export function compile(projectDir: string): SemanticIR {
  const loaded = loadProject(projectDir)
  const entities = extractEntities(loaded.rootDir)
  const routes = extractRoutes(loaded)
  const serverActions = extractServerActions(loaded)
  const actions = [...routes.actions, ...serverActions.actions]

  return validateIR({
    app: { name: loaded.appName, framework: 'nextjs-app-router' },
    entities,
    actions,
    coverage: {
      extracted: actions.length,
      skipped: [...routes.skipped, ...serverActions.skipped],
    },
  })
}
