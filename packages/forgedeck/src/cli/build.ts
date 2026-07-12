/**
 * `forgedeck build` command wiring.
 *
 * ENFORCED RULE: commands contain no logic. This module parses flags, calls the
 * library (`runBuild`), and prints. All orchestration lives in `src/build.ts`.
 */

import { join, resolve } from 'node:path'
import type { Command } from 'commander'
import { runBuild } from '../build.js'
import { ConfigError } from '../config/schema.js'

export function registerBuild(program: Command): void {
  program
    .command('build')
    .argument('[dir]', 'project directory', '.')
    .option('--out <dir>', 'bundle output directory')
    .action(async (dir: string, opts: { out?: string }) => {
      const projectDir = resolve(dir)
      const outDir = resolve(opts.out ?? join(projectDir, '.agent'))
      try {
        const { report, written, bridges, public: pub } = await runBuild(projectDir, outDir)
        console.log(report)
        console.log(`\nwrote ${written.length} files to ${outDir}`)
        if (bridges.generated.length || bridges.removed.length) {
          console.log(
            `bridges: ${bridges.generated.length} generated, ${bridges.removed.length} removed`,
          )
        }
        if (pub) {
          console.log(
            `public storefront: ${pub.count} actions, ${pub.written.length} files → ${pub.outDir}`,
          )
        }
      } catch (err) {
        // A config error is the one deliberate build-breaking exception: print why
        // and exit non-zero. Every other error keeps its existing (thrown) behavior.
        if (err instanceof ConfigError) {
          console.error(`forgedeck: ${err.message}`)
          if (!err.message.includes(ConfigError.explanation)) console.error(ConfigError.explanation)
          process.exitCode = 1
          return
        }
        throw err
      }
    })
}
