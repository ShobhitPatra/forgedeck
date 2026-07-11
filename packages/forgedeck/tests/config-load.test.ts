import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, ConfigError } from '../src/config/load'

// Each test gets a throwaway project dir with a minimal `forgedeck` shim in
// node_modules so the config's `import { defineConfig } from 'forgedeck'`
// resolves exactly as it would in a real installed project.
function makeProject(configFileName: string | null, source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'fd-cfg-'))
  const shim = join(dir, 'node_modules', 'forgedeck')
  mkdirSync(shim, { recursive: true })
  writeFileSync(
    join(shim, 'package.json'),
    JSON.stringify({ name: 'forgedeck', version: '0.0.0', type: 'module', exports: './index.js' }),
  )
  writeFileSync(join(shim, 'index.js'), 'export const defineConfig = (c) => c;\n')
  if (configFileName) writeFileSync(join(dir, configFileName), source)
  return dir
}

const savedEnv = { FORGEDECK_ENV: process.env.FORGEDECK_ENV, NODE_ENV: process.env.NODE_ENV }
const dirs: string[] = []

beforeEach(() => {
  delete process.env.FORGEDECK_ENV
  delete process.env.NODE_ENV
})
afterEach(() => {
  process.env.FORGEDECK_ENV = savedEnv.FORGEDECK_ENV
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
      'forgedeck.config.ts',
      `import { defineConfig } from 'forgedeck'
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

  it('applies environment overlay REPLACE semantics via FORGEDECK_ENV', async () => {
    process.env.FORGEDECK_ENV = 'staging'
    const dir = project(
      'forgedeck.config.ts',
      `import { defineConfig } from 'forgedeck'
       export default defineConfig({
         enabledActions: ['base_only'],
         environments: { staging: { enabledActions: ['staging_only'] } },
       })`,
    )
    const resolved = await loadConfig(dir)
    expect(resolved!.enabledActions).toEqual(['staging_only'])
    expect(resolved!.resolvedEnvLine).toBe('environment: staging (via FORGEDECK_ENV)')
  })

  it('returns undefined when no config file is present (defaults apply)', async () => {
    const dir = project(null, '')
    expect(await loadConfig(dir)).toBeUndefined()
  })

  it('rejects an unknown key with a did-you-mean suggestion (loud build error)', async () => {
    const dir = project('forgedeck.config.ts', `export default { enabledAction: ['x'] }`)
    await expect(loadConfig(dir)).rejects.toThrow(/did you mean 'enabledActions'/)
    await expect(loadConfig(dir)).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects the reserved `public` key with the v1 message', async () => {
    const dir = project('forgedeck.config.ts', `export default { public: false }`)
    await expect(loadConfig(dir)).rejects.toThrow(/public storefront ships in v1/)
  })

  it('turns malformed TS into a loud ConfigError build failure', async () => {
    const dir = project(
      'forgedeck.config.ts',
      `export default defineConfig({ this is not valid typescript @@@ `,
    )
    await expect(loadConfig(dir)).rejects.toBeInstanceOf(ConfigError)
  })

  it('loads a plain .mjs config without transpilation', async () => {
    const dir = project('forgedeck.config.mjs', `export default { enabledActions: ['a'] }`)
    const resolved = await loadConfig(dir)
    expect(resolved!.enabledActions).toEqual(['a'])
    expect(resolved!.bridges).toBe(false)
  })
})
