/**
 * `forgedeck serve` command wiring.
 *
 * ENFORCED RULE: commands contain no logic. This module parses flags, calls the
 * library (`startMcpServer` for stdio, `startHttpMcpServer` for HTTP), and lets it
 * print. All server behavior lives in `src/mcp/server.ts` and `src/serve-http.ts`.
 */

import { resolve } from 'node:path'
import type { Command } from 'commander'
import { startMcpServer } from '../mcp/server.js'
import { startHttpMcpServer } from '../serve-http.js'

export function registerServe(program: Command): void {
  program
    .command('serve')
    .description(
      'Serve the compiled bundle as an MCP server (stdio by default, or --http for a standalone HTTP transport — the sidecar/container mode). Set FORGEDECK_TARGET_HEADERS (a JSON object of header name to value, e.g. \'{"authorization":"Bearer ..."}\') to inject credentials into every proxied request. Over --http, set FORGEDECK_MCP_TOKEN to unlock the surface (unset = every request 404s). Secrets live in the environment only, never in config files.',
    )
    .option('--bundle <dir>', 'bundle directory', '.agent')
    .option('--target <url>', 'running app base url', 'http://localhost:3000')
    .option('--http', 'serve over a standalone HTTP transport instead of stdio', false)
    .option('--port <port>', 'HTTP port (only with --http)', '8976')
    .action(async (opts: { bundle: string; target: string; http: boolean; port: string }) => {
      const bundle = resolve(opts.bundle)
      if (opts.http) {
        await startHttpMcpServer({
          port: Number(opts.port),
          bundleDir: bundle,
          targetUrl: opts.target,
        })
        return
      }
      await startMcpServer(bundle, opts.target)
    })
}
