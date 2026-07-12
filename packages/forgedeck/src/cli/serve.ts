/**
 * `forgedeck serve` command wiring.
 *
 * ENFORCED RULE: commands contain no logic. This module parses flags, calls the
 * library (`startMcpServer`), and prints. All server behavior lives in
 * `src/mcp/server.ts`.
 */

import { resolve } from 'node:path'
import type { Command } from 'commander'
import { startMcpServer } from '../mcp/server.js'

export function registerServe(program: Command): void {
  program
    .command('serve')
    .description(
      'Serve the compiled bundle as an MCP server. Set FORGEDECK_TARGET_HEADERS (a JSON object of header name to value, e.g. \'{"authorization":"Bearer ..."}\') to inject credentials into every proxied request. Secrets live in the environment only, never in config files.',
    )
    .option('--bundle <dir>', 'bundle directory', '.agent')
    .option('--target <url>', 'running app base url', 'http://localhost:3000')
    .action(async (opts: { bundle: string; target: string }) => {
      await startMcpServer(resolve(opts.bundle), opts.target)
    })
}
