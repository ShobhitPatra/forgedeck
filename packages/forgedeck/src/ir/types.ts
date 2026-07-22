import { z } from 'zod'
import { computeScopeVerdict } from './verdict.js'

export type Effect = 'read' | 'write' | 'irreversible'
export type AuthRequirement = 'none' | 'required' | 'unknown'
export type Framework = 'nextjs-app-router' | 'nextjs-pages-router' | 'nextjs-hybrid'
export interface InputField {
  name: string
  type: 'string' | 'number' | 'boolean' | 'unknown'
  required: boolean
  location: 'body' | 'query' | 'path'
}
export interface ActionIR {
  name: string
  kind: 'route' | 'server-action' | 'pages-api'
  method?: string
  path?: string
  sourceFile: string
  exportName: string
  description: string
  inputs: InputField[]
  effect: Effect
  entitiesTouched: string[]
  enabled: boolean
  // Why this action is enabled, when it is. `read-default` = a read enabled by the
  // safety default; `config-allowlist` = a mutation deliberately enabled by the
  // committed config (compile is the ONLY code path allowed to set this). Undefined
  // on disabled actions. The schema refinement below makes an enabled mutation that
  // config did not authorize structurally unrepresentable.
  enabledBy?: 'read-default' | 'config-allowlist'
  confidence: 'static'
  auth: AuthRequirement
  // Business preconditions a caller must satisfy, sourced from `@agent precondition`
  // tags on the handler/action declaration. Empty when the human channel is silent.
  preconditions: string[]
  evidence: string[]
}
// A named cross-call sequence assembled from `@agent workflow <name> step <n>` tags.
// `requires` is OMITTED when the tag carried no `requires` clause (matches the
// reader's WorkflowStep shape).
export interface WorkflowIR {
  name: string
  steps: { step: number; action: string; requires?: string }[]
}
export interface EntityIR {
  name: string
  fields: { name: string; type: string; optional: boolean }[]
  relations: { field: string; target: string }[]
  sourceFile: string
}
export interface CoverageItem {
  file: string
  reason: string
}
// The machine-honest scope fence: derived purely from extraction coverage (never
// from LLM inference), so it stays trustworthy even in --no-inference mode.
export interface ScopeVerdict {
  status: 'in' | 'partial' | 'out'
  extractedRatio: number
  dominantSkipReasons: string[]
}
export interface SemanticIR {
  app: { name: string; framework: Framework }
  entities: EntityIR[]
  actions: ActionIR[]
  workflows: WorkflowIR[]
  // `environment` is the resolved-environment line (e.g. `environment: base (via
  // default)`), present only when a config was loaded. Absent for config-less builds
  // so their coverage stays byte-identical.
  coverage: {
    extracted: number
    skipped: CoverageItem[]
    environment?: string
    verdict: ScopeVerdict
  }
}

const inputField = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'unknown']),
  required: z.boolean(),
  location: z.enum(['body', 'query', 'path']),
})

const action = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/),
    kind: z.enum(['route', 'server-action', 'pages-api']),
    method: z.string().optional(),
    path: z.string().optional(),
    sourceFile: z.string(),
    exportName: z.string(),
    description: z.string(),
    inputs: z.array(inputField),
    effect: z.enum(['read', 'write', 'irreversible']),
    entitiesTouched: z.array(z.string()),
    enabled: z.boolean(),
    enabledBy: z.enum(['read-default', 'config-allowlist']).optional(),
    confidence: z.literal('static'),
    auth: z.enum(['none', 'required', 'unknown']),
    preconditions: z.array(z.string()).default([]),
    evidence: z.array(z.string()),
  })
  // Safety invariant, enforced structurally: an action may be enabled ONLY as a
  // read-default read OR via the config allowlist. There is no shape that expresses
  // an enabled mutation the config did not authorize.
  .refine(
    (a) =>
      a.enabled === false ||
      (a.effect === 'read' && a.enabledBy === 'read-default') ||
      a.enabledBy === 'config-allowlist',
    {
      message:
        'enabled actions must be a read-default read or config-allowlist enabled (safety default)',
    },
  )

const entity = z.object({
  name: z.string(),
  fields: z.array(z.object({ name: z.string(), type: z.string(), optional: z.boolean() })),
  relations: z.array(z.object({ field: z.string(), target: z.string() })),
  sourceFile: z.string(),
})

const workflow = z.object({
  name: z.string(),
  steps: z.array(
    z.object({ step: z.number(), action: z.string(), requires: z.string().optional() }),
  ),
})

export const semanticIRSchema = z.object({
  app: z.object({
    name: z.string(),
    framework: z.enum(['nextjs-app-router', 'nextjs-pages-router', 'nextjs-hybrid']),
  }),
  entities: z.array(entity),
  actions: z.array(action).superRefine((arr, ctx) => {
    const seen = new Set<string>()
    for (const a of arr) {
      if (seen.has(a.name)) {
        ctx.addIssue({ code: 'custom', message: `duplicate action name: ${a.name}` })
      }
      seen.add(a.name)
    }
  }),
  workflows: z.array(workflow).default([]),
  coverage: z.object({
    extracted: z.number(),
    skipped: z.array(z.object({ file: z.string(), reason: z.string() })),
    environment: z.string().optional(),
    // Optional so IR shapes from before this field existed (e.g. `diff` re-validating
    // a checkout of an older ref, or a hand-built fixture in a test) still parse —
    // validateIR fills a computed verdict in below rather than throwing.
    verdict: z
      .object({
        status: z.enum(['in', 'partial', 'out']),
        extractedRatio: z.number(),
        dominantSkipReasons: z.array(z.string()),
      })
      .optional(),
  }),
}) as z.ZodType<SemanticIR>

export function validateIR(ir: unknown): SemanticIR {
  const parsed = semanticIRSchema.parse(ir)
  if (!parsed.coverage.verdict) {
    parsed.coverage.verdict = computeScopeVerdict(
      parsed.coverage.extracted,
      parsed.coverage.skipped,
    )
  }
  return parsed
}
