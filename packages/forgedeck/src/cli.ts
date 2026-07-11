#!/usr/bin/env node
import { join, resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { Command } from 'commander'
import { compile } from './compile.js'
import { emitBundle } from './emit/bundle.js'
import { renderCoverage } from './emit/coverage.js'
import { startMcpServer } from './mcp/server.js'

const program = new Command()
program.name('forgedeck').description('Compile your app into an MCP server').version('0.0.1')

program
  .command('build')
  .argument('[dir]', 'project directory', '.')
  .option('--out <dir>', 'bundle output directory')
  .action((dir: string, opts: { out?: string }) => {
    const projectDir = resolve(dir)
    const outDir = resolve(opts.out ?? join(projectDir, '.agent'))
    const ir = compile(projectDir)
    const written = emitBundle(ir, outDir)
    const report = renderCoverage(ir)
    writeFileSync(join(outDir, 'coverage.txt'), report)
    console.log(report)
    console.log(`\nwrote ${written.length} files to ${outDir}`)
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
