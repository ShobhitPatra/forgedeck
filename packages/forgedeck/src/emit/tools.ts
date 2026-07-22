import type { ActionIR, SemanticIR } from '../ir/types.js'

export interface ToolDef {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, { type: string }>; required: string[] }
  kind: 'route' | 'server-action' | 'pages-api'
  method?: string
  path?: string
  effect: string
  auth: string
  enabled: boolean
}
export interface ToolsManifest {
  app: string
  tools: ToolDef[]
}

// Derived descriptions (`${method} ${path}`, set at extraction) are bare and collide
// across near-duplicate routes ("GET /api/links/{id}" tells an agent nothing about
// which of several id-shaped tools to pick). When the description is still exactly
// that derived default, enrich it with effect/auth/param summary so same-resource
// tools separate. Tag- and JSDoc-authored descriptions (anything else) pass through
// unchanged — this precedence is what makes the human channel authoritative.
function enrichDerived(a: ActionIR): string {
  if (!a.method || !a.path) return a.description
  const derived = `${a.method} ${a.path}`
  if (a.description !== derived) return a.description
  const query = a.inputs.filter((i) => i.location === 'query').map((i) => i.name)
  const body = a.inputs.filter((i) => i.location === 'body').map((i) => i.name)
  const parts = [`${derived} — ${a.effect}`, `auth: ${a.auth}`]
  if (query.length) parts.push(`query: ${query.join(', ')}`)
  if (body.length) parts.push(`body: ${body.join(', ')}`)
  return parts.join('; ')
}

export function toToolsManifest(ir: SemanticIR): ToolsManifest {
  return {
    app: ir.app.name,
    tools: ir.actions.map((a) => ({
      name: a.name,
      // The description is the final precedence value (tag > harvest > derived). When
      // the action carries preconditions they are appended here, not hidden in a doc
      // page: the moment an agent decides to call is the moment the constraint matters.
      description: a.preconditions.length
        ? `${enrichDerived(a)} Preconditions: ${a.preconditions.join('; ')}`
        : enrichDerived(a),
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries(
          a.inputs.map((i) => [i.name, { type: i.type === 'unknown' ? 'string' : i.type }]),
        ),
        required: a.inputs.filter((i) => i.required).map((i) => i.name),
      },
      kind: a.kind,
      ...(a.method ? { method: a.method } : {}),
      ...(a.path ? { path: a.path } : {}),
      effect: a.effect,
      auth: a.auth,
      enabled: a.enabled,
    })),
  }
}
