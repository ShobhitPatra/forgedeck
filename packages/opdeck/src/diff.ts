/**
 * `diff` orchestration — the library half of `opdeck diff` (spec D3, P4).
 *
 * The semantic diff is the drift pitch made visible: it diffs the *meaning* of
 * the agent surface (the SemanticIR), never the bundle text. Two IRs compiled
 * from two git refs are compared structurally — actions added/removed and, per
 * surviving action, the changes that matter to a reviewer: an effect escalation
 * (read → write/irreversible), a newly required input, an auth change, the set of
 * entities it now touches, its description. Each change carries a severity so the
 * renderer can lead with what could hurt (HIGH) and fold the additive/cosmetic
 * (LOW) under a `<details>`. An unchanged surface produces the empty string:
 * credibility comes from speaking only when meaning changed.
 *
 * The CLI (`src/cli/diff.ts`) is a thin shell over `runDiff` — it resolves flags,
 * prints, and picks an exit code. All logic lives here.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { join, relative } from 'node:path'
import { compile } from './compile.js'
import type { ActionIR, AuthRequirement, Effect, InputField, SemanticIR } from './ir/types.js'

export type DiffSeverity = 'high' | 'medium' | 'low'

/** A light, JSON-friendly descriptor of an added or removed action. */
export interface ActionSummary {
  name: string
  kind: ActionIR['kind']
  effect: Effect
  auth: AuthRequirement
  method?: string
  path?: string
}

export interface EffectChange {
  from: Effect
  to: Effect
  /** True when the effect moved to a more dangerous class (read < write < irreversible). */
  escalation: boolean
}

export interface AuthChange {
  from: AuthRequirement
  to: AuthRequirement
}

export interface DescriptionChange {
  from: string
  to: string
}

/** Every change class found on one action that survived across both refs. */
export interface ActionChange {
  name: string
  effect?: EffectChange
  requiredInputsAdded: InputField[]
  requiredInputsRemoved: InputField[]
  optionalInputsAdded: InputField[]
  optionalInputsRemoved: InputField[]
  auth?: AuthChange
  entitiesAdded: string[]
  entitiesRemoved: string[]
  descriptionChanged?: DescriptionChange
}

export interface IRDiff {
  actionsAdded: ActionSummary[]
  actionsRemoved: ActionSummary[]
  actionsChanged: ActionChange[]
}

// Danger ordering for effect. A move to a higher rank is an escalation — the
// read-flag line the reviewer must see.
const EFFECT_RANK: Record<Effect, number> = { read: 0, write: 1, irreversible: 2 }

// Restrictiveness ordering for auth. `required` protects the most; `none` the
// least; `unknown` sits between (the handler decides). A move to a *lower* rank
// loosens protection — the security-relevant change.
const AUTH_RANK: Record<AuthRequirement, number> = { none: 0, unknown: 1, required: 2 }

function summarize(a: ActionIR): ActionSummary {
  return {
    name: a.name,
    kind: a.kind,
    effect: a.effect,
    auth: a.auth,
    ...(a.method ? { method: a.method } : {}),
    ...(a.path ? { path: a.path } : {}),
  }
}

// Whether an input counts as required in a given IR. An input present-and-required
// is required; anything else (absent, or present-but-optional) is not.
function requiredByName(inputs: InputField[]): Map<string, InputField> {
  return new Map(inputs.filter((i) => i.required).map((i) => [i.name, i]))
}
function optionalByName(inputs: InputField[]): Map<string, InputField> {
  return new Map(inputs.filter((i) => !i.required).map((i) => [i.name, i]))
}

// Diff one action against its earlier self. Returns undefined when nothing a
// reviewer cares about changed (identity by name is the caller's job).
function diffAction(base: ActionIR, head: ActionIR): ActionChange | undefined {
  const change: ActionChange = {
    name: head.name,
    requiredInputsAdded: [],
    requiredInputsRemoved: [],
    optionalInputsAdded: [],
    optionalInputsRemoved: [],
    entitiesAdded: [],
    entitiesRemoved: [],
  }
  let touched = false

  if (base.effect !== head.effect) {
    change.effect = {
      from: base.effect,
      to: head.effect,
      escalation: EFFECT_RANK[head.effect] > EFFECT_RANK[base.effect],
    }
    touched = true
  }

  // Required inputs. "Newly required" is either a new field that is required OR an
  // existing optional field that became required — both tighten the contract the
  // caller must satisfy, so both land in requiredInputsAdded.
  const baseReq = requiredByName(base.inputs)
  const headReq = requiredByName(head.inputs)
  for (const [name, field] of headReq)
    if (!baseReq.has(name)) change.requiredInputsAdded.push(field)
  for (const [name, field] of baseReq)
    if (!headReq.has(name)) change.requiredInputsRemoved.push(field)

  // Optional inputs, tracked among fields that are optional on both sides (a field
  // that flipped required-ness is already accounted for above).
  const baseOpt = optionalByName(base.inputs)
  const headOpt = optionalByName(head.inputs)
  for (const [name, field] of headOpt)
    if (!baseOpt.has(name) && !baseReq.has(name)) change.optionalInputsAdded.push(field)
  for (const [name, field] of baseOpt)
    if (!headOpt.has(name) && !headReq.has(name)) change.optionalInputsRemoved.push(field)

  if (
    change.requiredInputsAdded.length ||
    change.requiredInputsRemoved.length ||
    change.optionalInputsAdded.length ||
    change.optionalInputsRemoved.length
  )
    touched = true

  if (base.auth !== head.auth) {
    change.auth = { from: base.auth, to: head.auth }
    touched = true
  }

  const baseEnt = new Set(base.entitiesTouched)
  const headEnt = new Set(head.entitiesTouched)
  change.entitiesAdded = head.entitiesTouched.filter((e) => !baseEnt.has(e))
  change.entitiesRemoved = base.entitiesTouched.filter((e) => !headEnt.has(e))
  if (change.entitiesAdded.length || change.entitiesRemoved.length) touched = true

  if (base.description !== head.description) {
    change.descriptionChanged = { from: base.description, to: head.description }
    touched = true
  }

  return touched ? change : undefined
}

/** Structurally diff two compiled IRs. Actions are matched by tool name (stable,
 * the key agents and allowlists already use). */
export function diffIR(base: SemanticIR, head: SemanticIR): IRDiff {
  const baseByName = new Map(base.actions.map((a) => [a.name, a]))
  const headByName = new Map(head.actions.map((a) => [a.name, a]))

  const actionsAdded: ActionSummary[] = []
  const actionsRemoved: ActionSummary[] = []
  const actionsChanged: ActionChange[] = []

  for (const a of head.actions) if (!baseByName.has(a.name)) actionsAdded.push(summarize(a))
  for (const a of base.actions) if (!headByName.has(a.name)) actionsRemoved.push(summarize(a))
  for (const h of head.actions) {
    const b = baseByName.get(h.name)
    if (!b) continue
    const change = diffAction(b, h)
    if (change) actionsChanged.push(change)
  }

  // Stable output order for deterministic markdown and JSON.
  const byName = (x: { name: string }, y: { name: string }) =>
    x.name < y.name ? -1 : x.name > y.name ? 1 : 0
  actionsAdded.sort(byName)
  actionsRemoved.sort(byName)
  actionsChanged.sort(byName)
  return { actionsAdded, actionsRemoved, actionsChanged }
}

/** True when nothing a reviewer cares about changed — the surface's meaning held.
 * The renderer returns the empty string for such a diff (silent by default). */
export function isEmptyDiff(diff: IRDiff): boolean {
  return (
    diff.actionsAdded.length === 0 &&
    diff.actionsRemoved.length === 0 &&
    diff.actionsChanged.length === 0
  )
}

interface DiffLine {
  severity: DiffSeverity
  text: string
}

const EFFECT_ARROW = (c: EffectChange) => `${c.from} → ${c.to}`

// Flatten the typed diff into severity-tagged one-liners. This is the single
// place severity policy lives:
//   HIGH   — an escalation of capability or a loss of protection:
//            effect read → write/irreversible, a newly required input,
//            auth loosened (protection removed).
//   MEDIUM — a contract or reach change that is not an escalation:
//            removed required input, auth tightened, entities newly touched,
//            an action removed from the surface.
//   LOW    — additive or cosmetic: added action, added/removed optional input,
//            entities no longer touched, effect de-escalation, description edit.
function toLines(diff: IRDiff): DiffLine[] {
  const lines: DiffLine[] = []

  for (const a of diff.actionsRemoved)
    lines.push({ severity: 'medium', text: `**action removed** \`${a.name}\` (${a.effect})` })

  for (const c of diff.actionsChanged) {
    if (c.effect) {
      if (c.effect.escalation)
        lines.push({
          severity: 'high',
          text: `**effect escalation** \`${c.name}\`: ${EFFECT_ARROW(c.effect)}`,
        })
      else
        lines.push({
          severity: 'low',
          text: `**effect relaxed** \`${c.name}\`: ${EFFECT_ARROW(c.effect)}`,
        })
    }
    for (const i of c.requiredInputsAdded)
      lines.push({
        severity: 'high',
        text: `**new required input** \`${c.name}\`: \`${i.name}\` (${i.location})`,
      })
    if (c.auth) {
      const loosened = AUTH_RANK[c.auth.to] < AUTH_RANK[c.auth.from]
      lines.push({
        severity: loosened ? 'high' : 'medium',
        text: `**auth ${loosened ? 'loosened' : 'tightened'}** \`${c.name}\`: ${c.auth.from} → ${c.auth.to}`,
      })
    }
    for (const i of c.requiredInputsRemoved)
      lines.push({
        severity: 'medium',
        text: `**required input removed** \`${c.name}\`: \`${i.name}\` (${i.location})`,
      })
    if (c.entitiesAdded.length)
      lines.push({
        severity: 'medium',
        text: `**entities touched** \`${c.name}\`: + ${c.entitiesAdded.join(', ')}`,
      })
    for (const i of c.optionalInputsAdded)
      lines.push({
        severity: 'low',
        text: `**optional input added** \`${c.name}\`: \`${i.name}\` (${i.location})`,
      })
    for (const i of c.optionalInputsRemoved)
      lines.push({
        severity: 'low',
        text: `**optional input removed** \`${c.name}\`: \`${i.name}\` (${i.location})`,
      })
    if (c.entitiesRemoved.length)
      lines.push({
        severity: 'low',
        text: `**entities no longer touched** \`${c.name}\`: - ${c.entitiesRemoved.join(', ')}`,
      })
    if (c.descriptionChanged)
      lines.push({ severity: 'low', text: `**description changed** \`${c.name}\`` })
  }

  for (const a of diff.actionsAdded)
    lines.push({ severity: 'low', text: `**action added** \`${a.name}\` (${a.effect})` })

  return lines
}

/** Render the diff as severity-ordered markdown: HIGH first, then MEDIUM, with
 * additive/LOW folded under a `<details>`. An empty diff renders the empty string
 * (the Action writes nothing → no comment). */
export function renderDiffMarkdown(diff: IRDiff): string {
  if (isEmptyDiff(diff)) return ''
  const lines = toLines(diff)
  const high = lines.filter((l) => l.severity === 'high')
  const medium = lines.filter((l) => l.severity === 'medium')
  const low = lines.filter((l) => l.severity === 'low')

  const out: string[] = ['### opdeck semantic diff', '']

  if (high.length) {
    out.push(`**${high.length} high-severity change${high.length === 1 ? '' : 's'}** ⚠`, '')
    for (const l of high) out.push(`- ${l.text}`)
    out.push('')
  }
  if (medium.length) {
    out.push(`**${medium.length} other change${medium.length === 1 ? '' : 's'}**`, '')
    for (const l of medium) out.push(`- ${l.text}`)
    out.push('')
  }
  if (low.length) {
    out.push(
      `<details><summary>${low.length} additive / low-severity change${low.length === 1 ? '' : 's'}</summary>`,
      '',
    )
    for (const l of low) out.push(`- ${l.text}`)
    out.push('', '</details>')
  }

  return out.join('\n').trimEnd() + '\n'
}

/** Locate the git repository root that contains `dir`. */
function gitRoot(dir: string): string {
  return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim()
}

export interface RunDiffResult {
  diff: IRDiff
  markdown: string
}

/**
 * Compile the HEAD working tree and a base ref, then diff them.
 *
 * The base ref is materialized with `git worktree add --detach <tmp> <ref>` (a
 * clean checkout that never disturbs the developer's working tree or index), the
 * project subdir is compiled inside it, and the worktree is torn down in a
 * `finally`. Extraction is fully static — no install runs in the worktree — so
 * this stays keyless and fast, matching the D3 "seconds, deterministic" promise.
 */
export async function runDiff(baseRef: string, projectDir: string): Promise<RunDiffResult> {
  const root = gitRoot(projectDir)
  const rel = relative(root, projectDir)
  const worktree = mkdtempSync(join(tmpdir(), 'opdeck-diff-'))
  try {
    execFileSync('git', ['-C', root, 'worktree', 'add', '--detach', worktree, baseRef], {
      stdio: 'pipe',
    })
    const [head, base] = await Promise.all([compile(projectDir), compile(join(worktree, rel))])
    const diff = diffIR(base, head)
    return { diff, markdown: renderDiffMarkdown(diff) }
  } finally {
    // Remove the worktree bookkeeping, then the tmp dir itself. `--force` covers a
    // worktree that never fully materialized; the rmSync is the backstop.
    try {
      execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', worktree], {
        stdio: 'pipe',
      })
    } catch {
      // fall through to the filesystem removal
    }
    rmSync(worktree, { recursive: true, force: true })
  }
}
