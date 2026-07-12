import type { SemanticIR } from '../ir/types.js'

/**
 * The public-storefront summary folded into the INTERNAL bundle's coverage report,
 * so the one committed audit surface records exactly what left the building publicly.
 * Omitted entirely when the storefront is off (config-less / `public` unset).
 */
export interface PublicCoverageInfo {
  /** Actions surviving into `.agent-public/`. */
  count: number
  /** Explicitly-named actions that are NOT reads — each surfaced loudly. */
  namedMutations: string[]
  /** `public.actions` names matching no extracted action. */
  unmatchedNamed: string[]
}

export function renderCoverage(ir: SemanticIR, publicInfo?: PublicCoverageInfo): string {
  const byKind = (k: string) => ir.actions.filter((a) => a.kind === k).length
  const lines = [
    `forgedeck coverage for ${ir.app.name}`,
    `${ir.coverage.extracted} actions extracted (${byKind('route')} app router, ${byKind('pages-api')} pages api, ${byKind('server-action')} server actions), ${ir.coverage.skipped.length} skipped`,
    `${ir.entities.length} entities from prisma schema`,
    `auth: ${ir.actions.filter((a) => a.auth === 'required').length} required, ${ir.actions.filter((a) => a.auth === 'unknown').length} unknown, ${ir.actions.filter((a) => a.auth === 'none').length} none`,
  ]
  // The resolved-environment line appears only when a config was loaded; config-less
  // builds omit it so their coverage stays byte-identical.
  if (ir.coverage.environment) lines.push(ir.coverage.environment)
  lines.push('')
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
  // Public-storefront summary: the internal audit surface names the exact public
  // surface. Every named mutation is LOUD (a deliberate exception to reads-only), and
  // an enabled-but-empty storefront warns rather than silently shipping nothing.
  if (publicInfo) {
    lines.push(`PUBLIC: ${publicInfo.count} actions`)
    for (const name of publicInfo.namedMutations)
      lines.push(`PUBLIC MUTATION by explicit config: ${name}`)
    for (const name of publicInfo.unmatchedNamed)
      lines.push(`WARN public action '${name}' named in config matched no extracted action`)
    if (publicInfo.count === 0) lines.push('WARN public storefront enabled but no actions qualify')
  }
  return lines.join('\n')
}
