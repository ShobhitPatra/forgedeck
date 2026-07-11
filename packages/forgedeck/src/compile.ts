import { validateIR, type SemanticIR } from './ir/types.js'
import { loadProject } from './load/project.js'
import { extractEntities } from './extract/entities.js'
import { extractRoutes } from './extract/routes.js'
import { extractServerActions } from './extract/actions.js'
import { extractPagesApi } from './extract/pagesApi.js'

export function compile(projectDir: string): SemanticIR {
  const loaded = loadProject(projectDir)
  const entities = extractEntities(loaded.rootDir)
  const routes = extractRoutes(loaded)
  const serverActions = extractServerActions(loaded)
  const pagesApi = extractPagesApi(loaded)
  const actions = [...routes.actions, ...serverActions.actions, ...pagesApi.actions]

  return validateIR({
    app: { name: loaded.appName, framework: loaded.framework },
    entities,
    actions,
    coverage: {
      extracted: actions.length,
      skipped: [...routes.skipped, ...serverActions.skipped, ...pagesApi.skipped],
    },
  })
}
