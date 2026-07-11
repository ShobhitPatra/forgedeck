#!/usr/bin/env node
import { join, resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { Command } from 'commander'
import { compile } from './compile.js'
import { emitBundle } from './emit/bundle.js'
import { renderCoverage } from './emit/coverage.js'
import { generateBridges } from './emit/bridges.js'
import { startMcpServer } from './mcp/server.js'
import { loadConfig } from './config/load.js'
import { ConfigError } from './config/schema.js'

const program = new Command()
program.name('forgedeck').description('Compile your app into an MCP server').version('0.0.1')

program
  .command('build')
  .argument('[dir]', 'project directory', '.')
  .option('--out <dir>', 'bundle output directory')
  .action(async (dir: string, opts: { out?: string }) => {
    const projectDir = resolve(dir)
    const outDir = resolve(opts.out ?? join(projectDir, '.agent'))
    try {
      const ir = await compile(projectDir)
      const config = await loadConfig(projectDir)
      const written = emitBundle(ir, outDir)
      // Bridges are written into the PROJECT (real Next.js routes), not the bundle out
      // dir, so this runs AFTER the emitters. Generation is gated on `config.bridges`;
      // a lock-4 coverage failure throws ConfigError and is handled below like any
      // other config error.
      const bridges = generateBridges(ir, config, projectDir, { write: config?.bridges === true })
      // Fold the bridge generated/removed notes into the coverage report.
      ir.coverage.skipped.push(...bridges.coverage)
      const report = renderCoverage(ir)
      writeFileSync(join(outDir, 'coverage.txt'), report)
      console.log(report)
      console.log(`\nwrote ${written.length} files to ${outDir}`)
      if (bridges.generated.length || bridges.removed.length) {
        console.log(
          `bridges: ${bridges.generated.length} generated, ${bridges.removed.length} removed`,
        )
      }
    } catch (err) {
      // A config error is the one deliberate build-breaking exception: print why and
      // exit non-zero. Every other error keeps its existing (thrown) behavior.
      if (err instanceof ConfigError) {
        console.error(`forgedeck: ${err.message}`)
        if (!err.message.includes(ConfigError.explanation)) console.error(ConfigError.explanation)
        process.exitCode = 1
        return
      }
      throw err
    }
  })

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

program.parseAsync()
