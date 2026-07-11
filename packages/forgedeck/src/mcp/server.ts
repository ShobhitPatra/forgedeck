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
  opts: { headers?: Record<string, string> } = {},
): Map<string, { def: ToolDef; run(args: Record<string, unknown>): Promise<string> }> {
  const injected = opts.headers ?? {}
  const handlers = new Map<
    string,
    { def: ToolDef; run(args: Record<string, unknown>): Promise<string> }
  >()

  for (const def of manifest.tools) {
    // Both `route` and `pages-api` tools are plain HTTP endpoints addressable by
    // method+path, so both dispatch through this proxy. `server-action` tools have
    // no HTTP address of their own and are handled by bridge dispatch (Task 4).
    if (!def.enabled || (def.kind !== 'route' && def.kind !== 'pages-api')) continue
    if (!def.path || !def.method) continue
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
          const init: RequestInit = { method: 'GET' }
          if (Object.keys(injected).length) init.headers = { ...injected }
          const res = await fetchImpl(`${base}${path}${qs}`, init)
          return await res.text()
        }
        // Request-specific content-type wins over any injected content-type on conflict.
        const res = await fetchImpl(`${base}${path}`, {
          method: def.method,
          headers: { ...injected, 'content-type': 'application/json' },
          body: JSON.stringify(rest),
        })
        return await res.text()
      },
    })
  }
  return handlers
}

/**
 * Parse the FORGEDECK_TARGET_HEADERS env var: a JSON object of header name → value.
 * On any parse error or non-object shape, print a loud warning and return undefined
 * so the server continues WITHOUT injected headers rather than crashing.
 */
export function parseTargetHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (raw === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    console.error(
      `forgedeck: FORGEDECK_TARGET_HEADERS is not valid JSON, ignoring credential headers: ${
        (err as Error).message
      }`,
    )
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    console.error(
      'forgedeck: FORGEDECK_TARGET_HEADERS must be a JSON object of string headers, ignoring credential headers',
    )
    return undefined
  }
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) headers[k] = String(v)
  return headers
}

const JSON_TO_ZOD: Record<string, z.ZodTypeAny> = {
  string: z.string(),
  number: z.number(),
  boolean: z.boolean(),
}

export async function startMcpServer(bundleDir: string, targetUrl: string): Promise<void> {
  const manifest: ToolsManifest = JSON.parse(readFileSync(join(bundleDir, 'tools.json'), 'utf8'))
  const server = new McpServer({ name: `forgedeck ${manifest.app}`, version: '0.0.1' })
  const headers = parseTargetHeaders(process.env.FORGEDECK_TARGET_HEADERS)

  for (const { def, run } of buildToolHandlers(manifest, targetUrl, fetch, { headers }).values()) {
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
