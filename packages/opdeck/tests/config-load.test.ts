import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, ConfigError, rewriteDefineConfigImport } from '../src/config/load'

// Each test gets a throwaway project dir with a minimal `opdeck` shim in
// node_modules so the config's `import { defineConfig } from 'opdeck'`
// resolves exactly as it would in a real installed project.
function makeProject(configFileName: string | null, source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'fd-cfg-'))
  const shim = join(dir, 'node_modules', 'opdeck')
  mkdirSync(shim, { recursive: true })
  writeFileSync(
    join(shim, 'package.json'),
    JSON.stringify({ name: 'opdeck', version: '0.0.0', type: 'module', exports: './index.js' }),
  )
  writeFileSync(join(shim, 'index.js'), 'export const defineConfig = (c) => c;\n')
  if (configFileName) writeFileSync(join(dir, configFileName), source)
  return dir
}

const savedEnv = { OPDECK_ENV: process.env.OPDECK_ENV, NODE_ENV: process.env.NODE_ENV }
const dirs: string[] = []

beforeEach(() => {
  delete process.env.OPDECK_ENV
  delete process.env.NODE_ENV
})
afterEach(() => {
  process.env.OPDECK_ENV = savedEnv.OPDECK_ENV
  process.env.NODE_ENV = savedEnv.NODE_ENV
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function project(name: string | null, src: string): string {
  const d = makeProject(name, src)
  dirs.push(d)
  return d
}

describe('loadConfig', () => {
  it('loads and validates a valid TS config (transpile -> temp mjs -> import)', async () => {
    const dir = project(
      'opdeck.config.ts',
      `import { defineConfig } from 'opdeck'
       export default defineConfig({
         exclude: ['ee/**'],
         out: '.agent',
         enabledActions: ['post_documents'],
         bridges: true,
       })`,
    )
    const resolved = await loadConfig(dir)
    expect(resolved).toBeDefined()
    expect(resolved!.exclude).toEqual(['ee/**'])
    expect(resolved!.out).toBe('.agent')
    expect(resolved!.enabledActions).toEqual(['post_documents'])
    expect(resolved!.bridges).toBe(true)
    expect(resolved!.resolvedEnvLine).toBe('environment: base (via default)')
  })

  it('applies environment overlay REPLACE semantics via OPDECK_ENV', async () => {
    process.env.OPDECK_ENV = 'staging'
    const dir = project(
      'opdeck.config.ts',
      `import { defineConfig } from 'opdeck'
       export default defineConfig({
         enabledActions: ['base_only'],
         environments: { staging: { enabledActions: ['staging_only'] } },
       })`,
    )
    const resolved = await loadConfig(dir)
    expect(resolved!.enabledActions).toEqual(['staging_only'])
    expect(resolved!.resolvedEnvLine).toBe('environment: staging (via OPDECK_ENV)')
  })

  it('returns undefined when no config file is present (defaults apply)', async () => {
    const dir = project(null, '')
    expect(await loadConfig(dir)).toBeUndefined()
  })

  it('rejects an unknown key with a did-you-mean suggestion (loud build error)', async () => {
    const dir = project('opdeck.config.ts', `export default { enabledAction: ['x'] }`)
    await expect(loadConfig(dir)).rejects.toThrow(/did you mean 'enabledActions'/)
    await expect(loadConfig(dir)).rejects.toBeInstanceOf(ConfigError)
  })

  it('loads a `public: true` storefront setting through to the resolved config', async () => {
    const dir = project('opdeck.config.ts', `export default { public: true }`)
    const resolved = await loadConfig(dir)
    expect(resolved!.public).toBe(true)
  })

  it('loads a named-actions storefront and honors an environment `public` override', async () => {
    const dir = project(
      'opdeck.config.ts',
      `export default {
         public: { actions: ['get_health'] },
         environments: { staging: { public: true } },
       }`,
    )
    process.env.OPDECK_ENV = 'staging'
    const resolved = await loadConfig(dir)
    expect(resolved!.public).toBe(true)
  })

  it('rejects a malformed `public` value as a loud ConfigError', async () => {
    const dir = project('opdeck.config.ts', `export default { public: false }`)
    await expect(loadConfig(dir)).rejects.toBeInstanceOf(ConfigError)
  })

  it('turns malformed TS into a loud ConfigError build failure', async () => {
    const dir = project(
      'opdeck.config.ts',
      `export default defineConfig({ this is not valid typescript @@@ `,
    )
    await expect(loadConfig(dir)).rejects.toBeInstanceOf(ConfigError)
  })

  it('loads a plain .mjs config without transpilation', async () => {
    const dir = project('opdeck.config.mjs', `export default { enabledActions: ['a'] }`)
    const resolved = await loadConfig(dir)
    expect(resolved!.enabledActions).toEqual(['a'])
    expect(resolved!.bridges).toBe(false)
  })

  it("loads a config importing defineConfig from 'opdeck' with no package installed", async () => {
    // No node_modules shim here: the loader satisfies the identity import by rewriting
    // it, so a target app's config resolves even though 'opdeck' is unresolvable.
    const dir = mkdtempSync(join(tmpdir(), 'fd-noshim-'))
    dirs.push(dir)
    writeFileSync(
      join(dir, 'opdeck.config.ts'),
      `import { defineConfig } from 'opdeck'
       export default defineConfig({ enabledActions: ['post_documents'] })`,
    )
    const resolved = await loadConfig(dir)
    expect(resolved!.enabledActions).toEqual(['post_documents'])
  })

  it('lists environment blocks whose overlay did not apply this build', async () => {
    const dir = project(
      'opdeck.config.ts',
      `export default {
         enabledActions: ['base_only'],
         environments: { staging: { enabledActions: ['s'] }, prod: { enabledActions: ['p'] } },
       }`,
    )
    const resolved = await loadConfig(dir)
    // Base is active (no env var), so both declared blocks are dormant.
    expect(resolved!.unappliedEnvironments.sort()).toEqual(['prod', 'staging'])
  })
})

describe('rewriteDefineConfigImport', () => {
  it('replaces the opdeck defineConfig import with a local identity', () => {
    const out = rewriteDefineConfigImport(
      `import { defineConfig } from 'opdeck'\nexport default defineConfig({})`,
    )
    expect(out).toContain('const defineConfig = (c) => c;')
    expect(out).not.toMatch(/from ['"]opdeck['"]/)
  })
  it('tolerates leading indentation and double quotes', () => {
    const out = rewriteDefineConfigImport(`   import {defineConfig} from "opdeck";\nx`)
    expect(out).toContain('const defineConfig = (c) => c;')
  })
  it('leaves other imports untouched', () => {
    const out = rewriteDefineConfigImport(
      `import { z } from 'zod'\nimport { defineConfig } from 'opdeck'`,
    )
    expect(out).toContain(`import { z } from 'zod'`)
  })
})
