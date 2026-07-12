/**
 * `forgedeck diff` command wiring.
 *
 * ENFORCED RULE: commands contain no logic. This module parses flags, calls the
 * library (`runDiff`), prints, and picks an exit code. All diff behavior lives in
 * `src/diff.ts`.
 *
 * Exit posture (spec D3): exit 0 ALWAYS on a normal run — a semantic diff is a
 * report, not a gate. `--check` is the sole gate, and it fails ONLY when
 * extraction itself crashes on HEAD ("this PR breaks the agent surface"); a
 * non-empty diff is never a failure by itself.
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Command } from 'commander'
import { runDiff } from '../diff.js'

export function registerDiff(program: Command): void {
  program
    .command('diff')
    .description(
      'Semantic diff of the agent surface between a base git ref and the working tree. Compiles both to IR and reports what changed for a reviewer — effect escalations, newly required inputs, auth and entity changes. Silent when nothing changed. Exit 0 always; --check fails only if extraction crashes.',
    )
    .argument('[dir]', 'project directory', '.')
    .requiredOption('--base <ref>', 'git ref to diff the working tree against')
    .option('--format <fmt>', 'output format: md or json', 'md')
    .option('--check', 'fail (non-zero) only if extraction crashes on HEAD')
    .option('--out <file>', 'write the markdown to a file instead of stdout')
    .action(
      async (
        dir: string,
        opts: { base: string; format: string; check?: boolean; out?: string },
      ) => {
        let result
        try {
          result = await runDiff(opts.base, resolve(dir))
        } catch (err) {
          // Extraction crashed on HEAD. Under --check this is the one failing case:
          // the PR breaks the agent surface. Without --check, report and exit 0.
          const message = err instanceof Error ? err.message : String(err)
          console.error(`forgedeck diff: extraction failed — ${message}`)
          if (opts.check) process.exitCode = 1
          return
        }

        const { diff, markdown } = result

        if (opts.format === 'json') {
          console.log(JSON.stringify(diff, null, 2))
          return
        }

        // Markdown. An empty diff writes nothing to --out (the Action leaves no
        // comment) and prints the reassuring one-liner to the terminal.
        if (opts.out) {
          writeFileSync(resolve(opts.out), markdown)
        }
        if (markdown === '') {
          console.log('no semantic changes')
          return
        }
        if (!opts.out) console.log(markdown)
      },
    )
}
