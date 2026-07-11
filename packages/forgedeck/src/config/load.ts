import { existsSync, writeFileSync, rmSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ts } from 'ts-morph'
import {
  ConfigError,
  parseConfig,
  resolveEnvironment,
  type ParsedConfig,
  type ResolvedEnvironment,
} from './schema.js'

export { ConfigError } from './schema.js'
export { defineConfig } from './schema.js'

/** The fully resolved config a build consumes: base values plus the applied
 * environment overlay and a printable resolved-environment line for coverage. */
export interface ResolvedConfig {
  exclude: string[]
  out?: string
  enabledActions: string[]
  bridges: boolean
  environment: string
  environmentSource: ResolvedEnvironment['source']
  /** e.g. `environment: staging (via FORGEDECK_ENV)` — printed in every build's coverage. */
  resolvedEnvLine: string
}

// Config file names in priority order.
const CONFIG_FILES = ['forgedeck.config.ts', 'forgedeck.config.mjs', 'forgedeck.config.js']

/**
 * Find and load `forgedeck.config.{ts,mjs,js}` from `projectDir`, returning the
 * resolved config or `undefined` when no config file exists (defaults apply).
 *
 * TS is transpiled with the TypeScript compiler forgedeck already ships (via
 * ts-morph) — zero new deps — to a temp `.mjs` beside the config, dynamically
 * imported, then deleted. Any problem (transpile failure, bad import, invalid
 * shape) throws {@link ConfigError}: config errors are the one deliberate
 * exception to never-break-the-build.
 */
export async function loadConfig(projectDir: string): Promise<ResolvedConfig | undefined> {
  const found = CONFIG_FILES.map((f) => join(projectDir, f)).find(existsSync)
  if (!found) return undefined

  const raw = await importConfigModule(found)
  const parsed = parseConfig(raw)
  return resolve(parsed)
}

function resolve(parsed: ParsedConfig): ResolvedConfig {
  const env = resolveEnvironment(parsed, {
    FORGEDECK_ENV: process.env.FORGEDECK_ENV,
    NODE_ENV: process.env.NODE_ENV,
  })
  return {
    exclude: parsed.exclude ?? [],
    out: parsed.out,
    enabledActions: env.enabledActions,
    bridges: parsed.bridges,
    environment: env.name,
    environmentSource: env.source,
    resolvedEnvLine: env.line,
  }
}

// Import a config file's default export. `.ts` is transpiled to a sibling temp
// `.mjs` first; `.mjs`/`.js` are imported directly. Temp files are always cleaned
// up. Failures are wrapped as ConfigError so the build fails loudly with the reason.
async function importConfigModule(configPath: string): Promise<unknown> {
  const isTs = configPath.endsWith('.ts')
  let importPath = configPath
  let tempPath: string | undefined

  try {
    if (isTs) {
      const source = readFileSync(configPath, 'utf8')
      const transpiled = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
        reportDiagnostics: true,
      })
      const fatal = transpiled.diagnostics?.find((d) => d.category === ts.DiagnosticCategory.Error)
      if (fatal) {
        throw new ConfigError(
          `${configPath}: TypeScript error: ${ts.flattenDiagnosticMessageText(fatal.messageText, '\n')}\n${ConfigError.explanation}`,
        )
      }
      tempPath = join(configPath.slice(0, -3) + `.forgedeck-${process.pid}-${Date.now()}.mjs`)
      writeFileSync(tempPath, transpiled.outputText)
      importPath = tempPath
    }

    // Cache-bust so repeated loads within one process pick up file changes.
    const url = `${pathToFileURL(importPath).href}?t=${Date.now()}`
    let mod: { default?: unknown }
    try {
      mod = await import(url)
    } catch (e) {
      throw new ConfigError(
        `${configPath}: failed to load config: ${(e as Error).message}\n${ConfigError.explanation}`,
      )
    }
    if (!('default' in mod)) {
      throw new ConfigError(
        `${configPath}: config must have a default export (export default defineConfig({...}))\n${ConfigError.explanation}`,
      )
    }
    return mod.default
  } finally {
    if (tempPath) rmSync(tempPath, { force: true })
  }
}
