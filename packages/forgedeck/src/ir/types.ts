import { z } from 'zod'

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
  confidence: 'static'
  auth: AuthRequirement
  evidence: string[]
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
  app: { name: string; framework: Framework }
  entities: EntityIR[]
  actions: ActionIR[]
  coverage: { extracted: number; skipped: CoverageItem[] }
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
    confidence: z.literal('static'),
    auth: z.enum(['none', 'required', 'unknown']),
    evidence: z.array(z.string()),
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
  app: z.object({
    name: z.string(),
    framework: z.enum(['nextjs-app-router', 'nextjs-pages-router', 'nextjs-hybrid']),
  }),
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
