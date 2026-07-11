import { z } from 'zod'

export type Effect = 'read' | 'write' | 'irreversible'
export interface InputField {
  name: string
  type: 'string' | 'number' | 'boolean' | 'unknown'
  required: boolean
}
export interface ActionIR {
  name: string
  kind: 'route' | 'server-action'
  method?: string
  path?: string
  sourceFile: string
  exportName: string
  description: string
  inputs: InputField[]
  effect: Effect
  entitiesTouched: string[]
  enabled: boolean
  confidence: 'static'
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
export interface SemanticIR {
  app: { name: string; framework: 'nextjs-app-router' }
  entities: EntityIR[]
  actions: ActionIR[]
  coverage: { extracted: number; skipped: CoverageItem[] }
}

const inputField = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'unknown']),
  required: z.boolean(),
})

const action = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/),
    kind: z.enum(['route', 'server-action']),
    method: z.string().optional(),
    path: z.string().optional(),
    sourceFile: z.string(),
    exportName: z.string(),
    description: z.string(),
    inputs: z.array(inputField),
    effect: z.enum(['read', 'write', 'irreversible']),
    entitiesTouched: z.array(z.string()),
    enabled: z.boolean(),
    confidence: z.literal('static'),
  })
  .refine((a) => a.effect === 'read' || a.enabled === false, {
    message: 'non read actions must be disabled (safety default)',
  })

const entity = z.object({
  name: z.string(),
  fields: z.array(z.object({ name: z.string(), type: z.string(), optional: z.boolean() })),
  relations: z.array(z.object({ field: z.string(), target: z.string() })),
  sourceFile: z.string(),
})

export const semanticIRSchema = z.object({
  app: z.object({ name: z.string(), framework: z.literal('nextjs-app-router') }),
  entities: z.array(entity),
  actions: z.array(action),
  coverage: z.object({
    extracted: z.number(),
    skipped: z.array(z.object({ file: z.string(), reason: z.string() })),
  }),
}) as z.ZodType<SemanticIR>

export function validateIR(ir: unknown): SemanticIR {
  return semanticIRSchema.parse(ir)
}
