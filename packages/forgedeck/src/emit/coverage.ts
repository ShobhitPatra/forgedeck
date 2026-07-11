import type { SemanticIR } from '../ir/types.js'

export function renderCoverage(ir: SemanticIR): string {
  const byKind = (k: string) => ir.actions.filter((a) => a.kind === k).length
  const lines = [
    `forgedeck coverage for ${ir.app.name}`,
    `${ir.coverage.extracted} actions extracted (${byKind('route')} app router, ${byKind('pages-api')} pages api, ${byKind('server-action')} server actions), ${ir.coverage.skipped.length} skipped`,
    `${ir.entities.length} entities from prisma schema`,
    `auth: ${ir.actions.filter((a) => a.auth === 'required').length} required, ${ir.actions.filter((a) => a.auth === 'unknown').length} unknown, ${ir.actions.filter((a) => a.auth === 'none').length} none`,
    '',
  ]
  // SKIPPED lines carry every coverage warning already collected upstream, including
  // malformed-@agent-tag and annotation-conflict notes, so they surface here verbatim.
  for (const s of ir.coverage.skipped) lines.push(`SKIPPED ${s.file}: ${s.reason}`)
  // Harvest receipts: one line per action whose description was lifted from a JSDoc
  // summary (not an explicit @agent tag override). The receipt makes the harvest
  // auditable — nothing enters a bundle description unseen. `description` is the
  // harvested summary itself, already stopped at the first tag by the reader.
  const harvested = ir.actions.filter((a) =>
    a.evidence.includes('description harvested from jsdoc'),
  )
  for (const a of harvested) lines.push(`HARVESTED ${a.name}: "${a.description}"`)
  const noInputs = ir.actions.filter((a) => a.effect !== 'read' && a.inputs.length === 0)
  for (const a of noInputs)
    lines.push(`WARN ${a.name}: write action with no input contract detected`)
  const unknownAuthWrites = ir.actions.filter((a) => a.effect !== 'read' && a.auth === 'unknown')
  for (const a of unknownAuthWrites) lines.push(`WARN ${a.name}: auth unknown`)
  return lines.join('\n')
}
