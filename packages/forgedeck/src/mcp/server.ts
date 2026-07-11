import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { parseTargetHeaders, buildMcpServer, loadManifest } from './core.js'

// Re-export the transport-agnostic core so existing importers (and tests) that
// reach for these through `mcp/server` keep working unchanged. The behavior now
// lives in `mcp/core.ts` and is shared byte-for-byte with the HTTP route handler.
export { buildToolHandlers, parseTargetHeaders } from './core.js'

/**
 * Serve a compiled bundle over stdio. This is the `forgedeck serve` transport; it
 * builds the same McpServer the HTTP handler does (via the shared core) and wires
 * it to a StdioServerTransport.
 */
export async function startMcpServer(bundleDir: string, targetUrl: string): Promise<void> {
  const manifest = loadManifest(bundleDir)
  const headers = parseTargetHeaders(process.env.FORGEDECK_TARGET_HEADERS)
  const server = buildMcpServer(manifest, targetUrl, { headers })
  await server.connect(new StdioServerTransport())
}
