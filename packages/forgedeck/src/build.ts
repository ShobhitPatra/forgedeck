/**
 * `build` orchestration — the library half of `forgedeck build`.
 *
 * This is the tested seam the CLI is a thin shell over: it compiles the project
 * to IR, loads config, emits the bundle, generates bridges, folds the bridge
 * notes into coverage, writes `coverage.txt`, and returns the report plus the
 * counts the command needs to print. The CLI (`src/cli/build.ts`) does no
 * orchestration of its own — it resolves paths, calls `runBuild`, and prints.
 */

import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { compile } from './compile.js'
import { loadConfig } from './config/load.js'
import { emitBundle } from './emit/bundle.js'
import { renderCoverage } from './emit/coverage.js'
import { generateBridges } from './emit/bridges.js'

export interface BuildResult {
  /** The rendered coverage report — printed by the CLI and written to disk. */
  report: string
  /** Absolute paths of every bundle file written. */
  written: string[]
  /** Bridge generation outcome (generated/removed drive the CLI's summary line). */
  bridges: ReturnType<typeof generateBridges>
}

/**
 * Compile → config → emit → bridges → coverage for `projectDir`, writing the
 * bundle (and `coverage.txt`) into `outDir`. Both paths must already be resolved
 * to absolute. Throws on any error (a `ConfigError` is the deliberate
 * build-breaking case the CLI translates to a non-zero exit).
 */
export async function runBuild(projectDir: string, outDir: string): Promise<BuildResult> {
  const ir = await compile(projectDir)
  const config = await loadConfig(projectDir)
  const written = emitBundle(ir, outDir)
  // Bridges are written into the PROJECT (real Next.js routes), not the bundle out
  // dir, so this runs AFTER the emitters. Generation is gated on `config.bridges`;
  // a lock-4 coverage failure throws ConfigError, which the CLI handles.
  const bridges = generateBridges(ir, config, projectDir, { write: config?.bridges === true })
  // Fold the bridge generated/removed notes into the coverage report.
  ir.coverage.skipped.push(...bridges.coverage)
  const report = renderCoverage(ir)
  writeFileSync(join(outDir, 'coverage.txt'), report)
  return { report, written, bridges }
}
