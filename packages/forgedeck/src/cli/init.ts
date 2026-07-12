/**
 * `forgedeck init` command wiring.
 *
 * ENFORCED RULE: commands contain no logic. This module parses flags, calls the
 * library (`runInit`), and prints. All init behavior lives in `src/init.ts`.
 */

import { resolve } from 'node:path'
import type { Command } from 'commander'
import { runInit } from '../init.js'

export function registerInit(program: Command): void {
  program
    .command('init')
    .description(
      'Set up forgedeck in a Next.js App Router project: writes the /api/mcp shim, wraps next.config, scaffolds forgedeck.config.ts, gitignores .agent/, then runs the first build. Idempotent and never touches git.',
    )
    .argument('[dir]', 'project directory', '.')
    .option('--with-workflow', 'also write .github/workflows/forgedeck.yml (the PR diff Action)')
    .action(async (dir: string, opts: { withWorkflow?: boolean }) => {
      await runInit(resolve(dir), { withWorkflow: opts.withWorkflow })
    })
}
