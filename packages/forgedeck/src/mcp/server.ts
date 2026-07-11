import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { ToolDef, ToolsManifest } from '../emit/tools.js'

export function buildToolHandlers(
  manifest: ToolsManifest,
  targetUrl: string,
  fetchImpl: typeof fetch = fetch,
): Map<string, { def: ToolDef; run(args: Record<string, unknown>): Promise<string> }> {
  const handlers = new Map<
    string,
    { def: ToolDef; run(args: Record<string, unknown>): Promise<string> }
  >()

  for (const def of manifest.tools) {
    if (!def.enabled || def.kind !== 'route' || !def.path || !def.method) continue
    handlers.set(def.name, {
      def,
      async run(args) {
        let path = def.path!
        const rest: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(args)) {
          if (path.includes(`{${k}}`)) path = path.replace(`{${k}}`, String(v))
          else rest[k] = v
        }
        const base = targetUrl.replace(/\/$/, '')
        if (def.method === 'GET') {
          const qs = Object.keys(rest).length
            ? '?' +
              new URLSearchParams(Object.entries(rest).map(([k, v]) => [k, String(v)])).toString()
            : ''
          const res = await fetchImpl(`${base}${path}${qs}`, { method: 'GET' })
          return await res.text()
        }
        const res = await fetchImpl(`${base}${path}`, {
          method: def.method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(rest),
        })
        return await res.text()
      },
    })
  }
  return handlers
}

const JSON_TO_ZOD: Record<string, z.ZodTypeAny> = {
  string: z.string(),
  number: z.number(),
  boolean: z.boolean(),
}

export async function startMcpServer(bundleDir: string, targetUrl: string): Promise<void> {
  const manifest: ToolsManifest = JSON.parse(readFileSync(join(bundleDir, 'tools.json'), 'utf8'))
  const server = new McpServer({ name: `forgedeck ${manifest.app}`, version: '0.0.1' })

  for (const { def, run } of buildToolHandlers(manifest, targetUrl).values()) {
    const shape: Record<string, z.ZodTypeAny> = {}
    for (const [prop, spec] of Object.entries(def.inputSchema.properties)) {
      const base = JSON_TO_ZOD[spec.type] ?? z.string()
      shape[prop] = def.inputSchema.required.includes(prop) ? base : base.optional()
    }
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: shape },
      async (args) => ({
        content: [{ type: 'text', text: await run(args as Record<string, unknown>) }],
      }),
    )
  }

  await server.connect(new StdioServerTransport())
}
