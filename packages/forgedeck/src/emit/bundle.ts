import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ActionIR, EntityIR, SemanticIR } from '../ir/types.js'
import { toToolsManifest } from './tools.js'

function write(outDir: string, rel: string, content: string, written: string[]) {
  const abs = join(outDir, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
  written.push(rel)
}

function actionMd(a: ActionIR): string {
  const inputs = a.inputs.length
    ? a.inputs.map((i) => `- \`${i.name}\` (${i.type}${i.required ? '' : ', optional'})`).join('\n')
    : '_none detected_'
  const evidence = a.evidence.length
    ? `\n## Evidence\n\n${a.evidence.map((e) => `- ${e}`).join('\n')}\n`
    : ''
  return `---
name: ${a.name}
kind: ${a.kind}${a.method ? `\nmethod: ${a.method}` : ''}${a.path ? `\npath: ${a.path}` : ''}
effect: ${a.effect}
auth: ${a.auth}
enabled: ${a.enabled}
confidence: ${a.confidence}
source: ${a.sourceFile}
---

# ${a.name}

${a.description}

## Inputs

${inputs}

## Touches

${a.entitiesTouched.length ? a.entitiesTouched.map((e) => `- ${e}`).join('\n') : '_none detected_'}
${evidence}`
}

function entityMd(e: EntityIR): string {
  return `---
name: ${e.name}
source: ${e.sourceFile}
---

# ${e.name}

## Fields

${e.fields.map((f) => `- \`${f.name}\`: ${f.type}${f.optional ? ' (optional)' : ''}`).join('\n')}

## Relations

${e.relations.length ? e.relations.map((r) => `- \`${r.field}\` → ${r.target}`).join('\n') : '_none_'}
`
}

function indexMd(ir: SemanticIR): string {
  return `# ${ir.app.name}

Agent bundle compiled by forgedeck. Framework: ${ir.app.framework}.

- ${ir.entities.length} entities: ${ir.entities.map((e) => `[${e.name}](entities/${e.name.toLowerCase()}.md)`).join(', ')}
- ${ir.actions.length} actions: ${ir.actions.map((a) => `[${a.name}](actions/${a.name}.md)`).join(', ')}

Execution manifest: [tools.json](tools.json). Read tools are enabled; mutations are disabled by default.
`
}

export function emitBundle(ir: SemanticIR, outDir: string): string[] {
  const written: string[] = []
  write(outDir, 'index.md', indexMd(ir), written)
  for (const e of ir.entities)
    write(outDir, `entities/${e.name.toLowerCase()}.md`, entityMd(e), written)
  for (const a of ir.actions) write(outDir, `actions/${a.name}.md`, actionMd(a), written)
  write(outDir, 'tools.json', JSON.stringify(toToolsManifest(ir), null, 2), written)
  write(outDir, 'ir.json', JSON.stringify(ir, null, 2), written)
  return written
}
