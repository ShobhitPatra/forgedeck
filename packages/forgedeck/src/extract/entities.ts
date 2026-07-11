import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { CoverageItem, EntityIR } from '../ir/types.js'

function localSchemaSources(projectDir: string): { text: string; rel: string }[] {
  const pkgPath = join(projectDir, 'package.json')
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    const override = pkg?.prisma?.schema
    if (typeof override === 'string' && existsSync(join(projectDir, override))) {
      return collect(projectDir, override)
    }
  }
  if (existsSync(join(projectDir, 'prisma', 'schema.prisma'))) {
    return collect(projectDir, 'prisma/schema.prisma')
  }
  if (existsSync(join(projectDir, 'prisma', 'schema'))) {
    return collect(projectDir, 'prisma/schema')
  }
  return []
}

// A package.json declares a workspace when it either lives beside a
// pnpm-workspace.yaml or carries a `workspaces` field (npm/yarn/bun style).
function isWorkspaceRoot(dir: string): boolean {
  if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return true
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return false
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    return pkg?.workspaces !== undefined
  } catch {
    return false
  }
}

// Production monorepos (formbricks-style) keep the schema in packages/database
// while surfaces live in apps/*. When local resolution finds nothing, walk UP
// at most 3 levels for a workspace root, then glob packages/*/prisma schemas.
// First hit wins in alphabetical package order for determinism. Returns the
// schema sources with rel paths measured from the workspace root (no ../).
function workspaceSchemaSources(projectDir: string): { text: string; rel: string }[] {
  let dir = resolve(projectDir)
  for (let level = 0; level <= 3; level++) {
    if (isWorkspaceRoot(dir)) {
      const packagesDir = join(dir, 'packages')
      if (!existsSync(packagesDir)) return []
      const pkgs = readdirSync(packagesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
      for (const pkg of pkgs) {
        const rel = `packages/${pkg}/prisma/schema.prisma`
        const relDir = `packages/${pkg}/prisma/schema`
        if (existsSync(join(dir, rel))) return collect(dir, rel)
        if (existsSync(join(dir, relDir))) return collect(dir, relDir)
      }
      return []
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return []
}

function collect(projectDir: string, rel: string): { text: string; rel: string }[] {
  const abs = join(projectDir, rel)
  try {
    const entries = readdirSync(abs, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.prisma'))
      .map((e) => ({ text: readFileSync(join(abs, e.name), 'utf8'), rel: `${rel}/${e.name}` }))
  } catch {
    return [{ text: readFileSync(abs, 'utf8'), rel }]
  }
}

function parseEntities(sources: { text: string; rel: string }[]): EntityIR[] {
  const parsed = sources.map((source) => ({
    rel: source.rel,
    blocks: [...source.text.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g)],
  }))

  const modelNames = new Set<string>()
  for (const source of parsed) {
    for (const block of source.blocks) modelNames.add(block[1])
  }

  const entities: EntityIR[] = []
  for (const source of parsed) {
    for (const [, name, body] of source.blocks) {
      const fields: EntityIR['fields'] = []
      const relations: EntityIR['relations'] = []
      for (const line of body.split('\n')) {
        const m = line.trim().match(/^(\w+)\s+(\w+)(\[\])?(\?)?/)
        if (!m) continue
        const [, fieldName, type, isList, isOptional] = m
        if (modelNames.has(type)) {
          relations.push({ field: fieldName, target: type })
        } else {
          fields.push({ name: fieldName, type: type + (isList ?? ''), optional: !!isOptional })
        }
      }
      entities.push({ name, fields, relations, sourceFile: source.rel })
    }
  }
  return entities
}

// extractEntities keeps its EntityIR[] shape for all existing callers. The
// richer variant additionally reports a coverage note when the schema was only
// found by walking up to the workspace root, so compile can surface it.
export function extractEntitiesWithSource(projectDir: string): {
  entities: EntityIR[]
  workspaceNote?: CoverageItem
} {
  const local = localSchemaSources(projectDir)
  if (local.length > 0) return { entities: parseEntities(local) }

  const workspace = workspaceSchemaSources(projectDir)
  if (workspace.length === 0) return { entities: [] }

  return {
    entities: parseEntities(workspace),
    workspaceNote: {
      file: workspace[0].rel,
      reason: 'entities resolved from workspace package',
    },
  }
}

export function extractEntities(projectDir: string): EntityIR[] {
  return extractEntitiesWithSource(projectDir).entities
}
