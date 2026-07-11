import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { EntityIR } from '../ir/types.js'

export function extractEntities(projectDir: string): EntityIR[] {
  const schemaPath = join(projectDir, 'prisma', 'schema.prisma')
  if (!existsSync(schemaPath)) return []
  const text = readFileSync(schemaPath, 'utf8')

  const modelBlocks = [...text.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g)]
  const modelNames = new Set(modelBlocks.map((m) => m[1]))

  return modelBlocks.map(([, name, body]) => {
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
    return { name, fields, relations, sourceFile: 'prisma/schema.prisma' }
  })
}
