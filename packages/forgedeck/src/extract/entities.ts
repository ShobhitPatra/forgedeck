import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { EntityIR } from '../ir/types.js'

function schemaSources(projectDir: string): { text: string; rel: string }[] {
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

export function extractEntities(projectDir: string): EntityIR[] {
  const sources = schemaSources(projectDir)
  if (sources.length === 0) return []

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
