import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ToolDef, ToolsManifest } from '../emit/tools.js'

// Transport-agnostic MCP core. Everything an MCP server needs to turn a compiled
// `.agent` bundle into live tools lives here — the tool proxy handlers, the target
// header parsing, and the McpServer registration loop. Both the stdio `serve` path
// (src/mcp/server.ts) and the HTTP route handler (src/next/handler.ts) consume this
// module, so the two transports serve BYTE-IDENTICAL tool behavior by construction.

// Turn an upstream Response into the string an MCP tool returns. A 2xx passes its
// body through unchanged. A non-2xx is a tool-level FAILURE and must look like one:
// we return an error STRING ('HTTP <status> <statusText>', plus the body when the
// upstream sent one) rather than throwing. Throwing would tear down the tool call;
// a string keeps the MCP session alive AND unmistakable, so an agent can never
// narrate a 404/500 as a successful empty result. Honesty over convenience.
async function readDispatchResult(res: Response): Promise<string> {
  const text = await res.text()
  if (res.ok) return text
  const line = `HTTP ${res.status} ${res.statusText}`.trimEnd()
  return text ? `${line}\n${text}` : line
}

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
    if (!def.enabled) continue

    // `server-action` tools have no HTTP address of their own: an enabled one is only
    // enabled because the config allowlist deliberately enabled it, which means Task 3
    // generated a bridge shim at `/api/.agent/<name>`. Dispatch POSTs there, carrying
    // the shared secret in `x-forgedeck-bridge-token` (read from FORGEDECK_BRIDGE_TOKEN
    // at call time) so the shim's lock-2 gate passes. The token is merged OVER any
    // injected credential headers so the env value is authoritative for its own key.
    if (def.kind === 'server-action') {
      handlers.set(def.name, {
        def,
        async run(args) {
          const base = targetUrl.replace(/\/$/, '')
          const token = process.env.FORGEDECK_BRIDGE_TOKEN
          const headers: Record<string, string> = {
            ...injected,
            'content-type': 'application/json',
          }
          if (token) headers['x-forgedeck-bridge-token'] = token
          const res = await fetchImpl(`${base}/api/.agent/${def.name}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(args),
          })
          return await readDispatchResult(res)
        },
      })
      continue
    }

    // Both `route` and `pages-api` tools are plain HTTP endpoints addressable by
    // method+path, so both dispatch through this proxy.
    if (def.kind !== 'route' && def.kind !== 'pages-api') continue
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
          return await readDispatchResult(res)
        }
        // Request-specific content-type wins over any injected content-type on conflict.
        const res = await fetchImpl(`${base}${path}`, {
          method: def.method,
          headers: { ...injected, 'content-type': 'application/json' },
          body: JSON.stringify(rest),
        })
        return await readDispatchResult(res)
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

/** Read and parse the tools.json manifest out of a compiled `.agent` bundle. */
export function loadManifest(bundleDir: string): ToolsManifest {
  return JSON.parse(readFileSync(join(bundleDir, 'tools.json'), 'utf8'))
}

/** The subset of McpServer that tool registration relies on — lets tests observe
 * exactly what would be registered without standing up a real transport. */
export interface ToolRegistrar {
  registerTool(
    name: string,
    config: { description: string; inputSchema: Record<string, z.ZodTypeAny> },
    handler: (
      args: Record<string, unknown>,
    ) => Promise<{ content: { type: 'text'; text: string }[] }>,
  ): unknown
}

/**
 * Register every enabled tool from `manifest` onto `registrar`, dispatching to
 * `targetUrl`. This is the ONE registration loop shared by stdio + HTTP: identical
 * tool set, identical schemas, identical dispatch, whatever the transport.
 */
export function registerTools(
  registrar: ToolRegistrar,
  manifest: ToolsManifest,
  targetUrl: string,
  opts: { headers?: Record<string, string>; fetchImpl?: typeof fetch } = {},
): void {
  const fetchImpl = opts.fetchImpl ?? fetch
  for (const { def, run } of buildToolHandlers(manifest, targetUrl, fetchImpl, {
    headers: opts.headers,
  }).values()) {
    const shape: Record<string, z.ZodTypeAny> = {}
    for (const [prop, spec] of Object.entries(def.inputSchema.properties)) {
      const base = JSON_TO_ZOD[spec.type] ?? z.string()
      shape[prop] = def.inputSchema.required.includes(prop) ? base : base.optional()
    }
    registrar.registerTool(
      def.name,
      { description: def.description, inputSchema: shape },
      async (args) => ({
        content: [{ type: 'text', text: await run(args as Record<string, unknown>) }],
      }),
    )
  }
}

/** Build a fully-registered McpServer for a manifest. Used by BOTH transports. */
export function buildMcpServer(
  manifest: ToolsManifest,
  targetUrl: string,
  opts: { headers?: Record<string, string> } = {},
): McpServer {
  const server = new McpServer({ name: `forgedeck ${manifest.app}`, version: '0.0.1' })
  registerTools(server as unknown as ToolRegistrar, manifest, targetUrl, opts)
  return server
}
