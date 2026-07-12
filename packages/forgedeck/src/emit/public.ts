/**
 * Public-storefront pruning (v1 spec D2, NORMATIVE).
 *
 * The public bundle is a SEPARATE artifact, derived from the full IR by removing
 * everything that is not provably safe to expose without a token. It is regenerated
 * by the SAME emitters over this filtered IR — never post-edited — so the internal
 * anatomy can never leak by construction:
 *
 *   - an action survives ONLY when it is a provably-public read
 *     (`auth: 'none'`, derived OR annotated, AND `effect: 'read'`), OR it is
 *     explicitly named in `public.actions` (any effect — a deliberate commitment).
 *   - `auth: 'unknown'` is NOT provable and is excluded, even for reads.
 *   - entities are pruned to only those the surviving actions touch; workflows to
 *     only those whose every step references a surviving action. The full internal
 *     map is therefore never present in the public artifact.
 */

import type { PublicConfig } from '../config/schema.js'
import type { SemanticIR } from '../ir/types.js'

export interface PublicPruneResult {
  /** The filtered IR the emitters regenerate the public bundle from. */
  ir: SemanticIR
  /** Explicitly-named actions whose effect is NOT read — deliberate public mutations. */
  namedMutations: string[]
  /** Names in `public.actions` that matched no extracted action (likely a typo). */
  unmatchedNamed: string[]
  /** Total actions surviving into the public bundle. */
  count: number
}

/** Filter `ir` down to the public surface described by `publicConfig`. */
export function prunePublicIR(ir: SemanticIR, publicConfig: PublicConfig): PublicPruneResult {
  const named = publicConfig === true ? [] : publicConfig.actions
  const namedSet = new Set(named)

  const actions = ir.actions.filter(
    (a) => (a.auth === 'none' && a.effect === 'read') || namedSet.has(a.name),
  )
  const publicNames = new Set(actions.map((a) => a.name))

  const namedMutations = actions
    .filter((a) => namedSet.has(a.name) && a.effect !== 'read')
    .map((a) => a.name)

  const extracted = new Set(ir.actions.map((a) => a.name))
  const unmatchedNamed = named.filter((n) => !extracted.has(n))

  // Entities: only those a surviving action touches. The internal data map is never
  // published wholesale.
  const touched = new Set<string>()
  for (const a of actions) for (const e of a.entitiesTouched) touched.add(e)
  const entities = ir.entities.filter((e) => touched.has(e.name))

  // Workflows: only those whose every step names a surviving action.
  const workflows = ir.workflows.filter((w) => w.steps.every((s) => publicNames.has(s.action)))

  const prunedIR: SemanticIR = {
    app: ir.app,
    entities,
    actions,
    workflows,
    coverage: { extracted: actions.length, skipped: [], environment: ir.coverage.environment },
  }
  return { ir: prunedIR, namedMutations, unmatchedNamed, count: actions.length }
}
