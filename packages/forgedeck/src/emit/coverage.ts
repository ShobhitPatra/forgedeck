import type { SemanticIR } from '../ir/types.js'

export function renderCoverage(ir: SemanticIR): string {
  const byKind = (k: string) => ir.actions.filter((a) => a.kind === k).length
  const lines = [
    `forgedeck coverage for ${ir.app.name}`,
    `${ir.coverage.extracted} actions extracted (${byKind('route')} app router, ${byKind('pages-api')} pages api, ${byKind('server-action')} server actions), ${ir.coverage.skipped.length} skipped`,
    `${ir.entities.length} entities from prisma schema`,
    '',
  ]
  for (const s of ir.coverage.skipped) lines.push(`SKIPPED ${s.file}: ${s.reason}`)
  const noInputs = ir.actions.filter((a) => a.effect !== 'read' && a.inputs.length === 0)
  for (const a of noInputs)
    lines.push(`WARN ${a.name}: write action with no input contract detected`)
  return lines.join('\n')
}
