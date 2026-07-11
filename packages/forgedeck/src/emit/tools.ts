import type { SemanticIR } from '../ir/types.js'

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

export function toToolsManifest(ir: SemanticIR): ToolsManifest {
  return {
    app: ir.app.name,
    tools: ir.actions.map((a) => ({
      name: a.name,
      description: a.description,
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
