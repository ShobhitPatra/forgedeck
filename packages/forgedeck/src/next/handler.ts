import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { timingSafeEqual } from 'node:crypto'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { buildMcpServer, loadManifest, parseTargetHeaders } from '../mcp/core.js'
import type { ToolsManifest } from '../emit/tools.js'

// The flagship adapter: `createForgedeckHandler()` turns a Next.js App Router route
// into the app's own MCP surface. The app serves its agent surface wherever it
// deploys — same process, same auth, self-targeting its own routes.
//
// LOCKED BY DEFAULT (v1 spec D2, normative). Adding forgedeck never exposes an app:
//   - FORGEDECK_MCP_TOKEN unset  -> EVERY request is an empty 404 (an invisible door,
//     not an open one).
//   - Authorization missing / not `Bearer <token>` / mismatched -> empty 404.
//   - Exact bearer match          -> serve MCP.
// A 404 (not 401/403) is deliberate: an unconfigured or wrongly-addressed route is
// indistinguishable from a route that does not exist. There is nothing to probe.

const HANDLER_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * Locate the compiled `.agent` bundle directory (the one containing `tools.json`).
 *
 * Resolution order (first hit wins):
 *   1. `<process.cwd()>/.agent` — the normal case. `next start` runs from the project
 *      root (or the standalone root), and the plugin's `outputFileTracingIncludes`
 *      copies `.agent/**` next to it, so cwd is authoritative.
 *   2. Module-relative fallbacks — walk up from this handler's own directory looking
 *      for a sibling `.agent`. Serverless file-tracing (`.next/standalone`, Vercel's
 *      `.next/server/...` layout) can relocate the compiled route far from cwd; these
 *      candidates recover the bundle when tracing nests it beside the emitted code.
 *
 * When nothing is found we throw LOUDLY listing every path tried, so a missing bundle
 * is an obvious deploy-config error rather than a silent empty tool list.
 */
export function resolveBundleDir(opts: { cwd?: string; moduleDir?: string } = {}): string {
  const cwd = opts.cwd ?? process.cwd()
  const moduleDir = opts.moduleDir ?? HANDLER_DIR

  const candidates: string[] = [join(cwd, '.agent')]
  // Walk up to 8 parents of the handler module, checking for a sibling `.agent`.
  let dir = moduleDir
  for (let i = 0; i < 8; i++) {
    candidates.push(join(dir, '.agent'))
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  const tried: string[] = []
  for (const candidate of candidates) {
    tried.push(candidate)
    if (existsSync(join(candidate, 'tools.json'))) return candidate
  }

  throw new Error(
    `forgedeck: could not locate the .agent bundle (no tools.json found). Tried:\n` +
      tried.map((p) => `  - ${p}`).join('\n') +
      `\nRun \`forgedeck build\` (or \`withForgedeck()\` at build time) and ensure ` +
      `.agent/ is traced into the deployment (outputFileTracingIncludes for /api/mcp).`,
  )
}

/**
 * The base URL every tool call is dispatched to. The standard mode is SELF-TARGET:
 * the in-app route calls the app's own HTTP routes on localhost, so the agent surface
 * lives in the same process it drives. `FORGEDECK_TARGET_URL` overrides for the rare
 * split-deploy case; otherwise we point at the app's own port (`PORT`, default 3000).
 */
export function resolveTargetUrl(): string {
  if (process.env.FORGEDECK_TARGET_URL) return process.env.FORGEDECK_TARGET_URL
  const port = process.env.PORT ?? '3000'
  return `http://localhost:${port}`
}

/** Constant-time bearer comparison — the token gate should not leak length or prefix
 * information through timing. Any shape mismatch fails closed. */
function bearerMatches(authorization: string | null, token: string): boolean {
  if (!authorization) return false
  const expected = `Bearer ${token}`
  const a = Buffer.from(authorization)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** The empty 404 that a locked or wrongly-addressed route returns. No body, no hint. */
function notFound(): Response {
  return new Response(null, { status: 404 })
}

/** Minimal shape the handler needs from a streamable-HTTP transport (test seam). */
interface RequestTransport {
  handleRequest(req: Request): Promise<Response>
}
/** Minimal shape the handler needs from an MCP server (test seam). */
interface ConnectableServer {
  connect(transport: unknown): Promise<void>
}

export interface CreateForgedeckHandlerOptions {
  /** @internal test seam — bundle dir override (skips resolveBundleDir). */
  bundleDir?: string
  /** @internal test seam — target URL override (skips resolveTargetUrl). */
  targetUrl?: string
  /** @internal test seam — manifest override (skips loadManifest). */
  manifest?: ToolsManifest
  /** @internal test seam — build a fresh per-request transport. */
  transportFactory?: () => RequestTransport
  /** @internal test seam — build a fresh per-request server. */
  serverFactory?: (manifest: ToolsManifest, targetUrl: string) => ConnectableServer
}

export type ForgedeckRouteHandler = (request: Request) => Promise<Response>

/**
 * The single transport-agnostic MCP request pipeline. Given a web-standard Fetch
 * `Request`, apply the locked-by-default token gate, then — only for an authorized
 * caller — resolve the bundle, build the server, and hand the raw Request to a fresh
 * stateless streamable-HTTP transport, returning its `Response`.
 *
 * Transport: the SDK 1.29 `WebStandardStreamableHTTPServerTransport` — a Fetch-native
 * (Request => Response) implementation of MCP streamable HTTP. We run it STATELESS
 * (`sessionIdGenerator: undefined`) with `enableJsonResponse: true`, minting a FRESH
 * transport + server per request and never touching a session store. The SDK forbids
 * reusing a stateless transport across requests, which is exactly the per-request
 * isolation a serverless route wants.
 *
 * BOTH the Next App Router handler (`createForgedeckHandler`) and the standalone HTTP
 * sidecar (`src/serve-http.ts`) call THIS function, so the two deployments share one
 * gate, one transport, and one tool posture byte-for-byte.
 */
export async function handleMcpRequest(
  request: Request,
  opts: CreateForgedeckHandlerOptions = {},
): Promise<Response> {
  const makeTransport =
    opts.transportFactory ??
    (() =>
      new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      }))
  const makeServer =
    opts.serverFactory ??
    ((manifest, targetUrl) =>
      buildMcpServer(manifest, targetUrl, {
        headers: parseTargetHeaders(process.env.FORGEDECK_TARGET_HEADERS),
      }) as unknown as ConnectableServer)

  // Gate FIRST, before touching the filesystem: an unauthorized caller learns
  // nothing and triggers no bundle resolution.
  const token = process.env.FORGEDECK_MCP_TOKEN
  if (!token) return notFound()
  if (!bearerMatches(request.headers.get('authorization'), token)) return notFound()

  // Authorized. Resolve the bundle + target and serve. A missing bundle throws
  // loudly here (surfacing to the authorized caller), never to an anonymous one.
  const manifest = opts.manifest ?? loadManifest(opts.bundleDir ?? resolveBundleDir())
  const targetUrl = opts.targetUrl ?? resolveTargetUrl()

  const server = makeServer(manifest, targetUrl)
  const transport = makeTransport()
  await server.connect(transport)
  return await transport.handleRequest(request)
}

/**
 * Build the `{ GET, POST }` App Router route handlers for the app's MCP surface.
 * Both verbs share the one gated pipeline in `handleMcpRequest` (see the file header
 * for the locked-by-default matrix).
 */
export function createForgedeckHandler(opts: CreateForgedeckHandlerOptions = {}): {
  GET: ForgedeckRouteHandler
  POST: ForgedeckRouteHandler
} {
  const handle = (request: Request): Promise<Response> => handleMcpRequest(request, opts)
  return { GET: handle, POST: handle }
}
