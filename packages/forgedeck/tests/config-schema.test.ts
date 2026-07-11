import { describe, it, expect } from 'vitest'
import {
  defineConfig,
  parseConfig,
  resolveEnvironment,
  ConfigError,
  type ForgedeckConfig,
} from '../src/config/schema'

describe('defineConfig', () => {
  it('is an identity function that returns its argument unchanged', () => {
    const cfg: ForgedeckConfig = { enabledActions: ['post_documents'] }
    expect(defineConfig(cfg)).toBe(cfg)
  })
})

describe('parseConfig', () => {
  it('accepts a valid config and applies the bridges default (false)', () => {
    const parsed = parseConfig({
      exclude: ['ee/**'],
      out: '.agent',
      enabledActions: ['post_documents'],
      environments: { staging: { enabledActions: ['delete_survey'] } },
    })
    expect(parsed.exclude).toEqual(['ee/**'])
    expect(parsed.out).toBe('.agent')
    expect(parsed.enabledActions).toEqual(['post_documents'])
    expect(parsed.bridges).toBe(false)
  })

  it('accepts bridges: true', () => {
    expect(parseConfig({ bridges: true }).bridges).toBe(true)
  })

  it('rejects an unknown key with a did-you-mean suggestion', () => {
    let err: unknown
    try {
      parseConfig({ enabledAction: ['x'] })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ConfigError)
    expect((err as Error).message).toContain("unknown config key 'enabledAction'")
    expect((err as Error).message).toContain("did you mean 'enabledActions'")
  })

  it('rejects an unknown key with no near match without a suggestion', () => {
    expect(() => parseConfig({ zzzzzz: 1 })).toThrow(/unknown config key 'zzzzzz'/)
    expect(() => parseConfig({ zzzzzz: 1 })).not.toThrow(/did you mean/)
  })

  it('rejects any non-undefined value for the reserved `public` key', () => {
    expect(() => parseConfig({ public: false })).toThrow(/public storefront ships in v1/)
    expect(() => parseConfig({ public: { actions: [] } })).toThrow(/public storefront ships in v1/)
  })

  it('allows an explicitly-undefined `public` key (reserved but inert)', () => {
    expect(() => parseConfig({ public: undefined })).not.toThrow()
  })

  it('rejects wrong value types via the strict schema', () => {
    expect(() => parseConfig({ enabledActions: 'post_documents' })).toThrow(ConfigError)
    expect(() => parseConfig({ exclude: [1, 2] })).toThrow(ConfigError)
    expect(() => parseConfig('nope')).toThrow(/must be an object/)
  })
})

describe('resolveEnvironment', () => {
  const cfg: ForgedeckConfig = {
    enabledActions: ['base_action'],
    environments: { staging: { enabledActions: ['staging_action'] } },
  }

  it('uses the base list when no env is selected', () => {
    const r = resolveEnvironment(cfg, {})
    expect(r.enabledActions).toEqual(['base_action'])
    expect(r.line).toBe('environment: base (via default)')
  })

  it('REPLACES the base list wholesale from the environment overlay', () => {
    const r = resolveEnvironment(cfg, { FORGEDECK_ENV: 'staging' })
    expect(r.enabledActions).toEqual(['staging_action'])
    expect(r.name).toBe('staging')
    expect(r.line).toBe('environment: staging (via FORGEDECK_ENV)')
  })

  it('prefers FORGEDECK_ENV over NODE_ENV', () => {
    const r = resolveEnvironment(cfg, { FORGEDECK_ENV: 'staging', NODE_ENV: 'production' })
    expect(r.source).toBe('FORGEDECK_ENV')
    expect(r.enabledActions).toEqual(['staging_action'])
  })

  it('falls back to NODE_ENV when FORGEDECK_ENV is unset', () => {
    const r = resolveEnvironment(cfg, { NODE_ENV: 'production' })
    expect(r.name).toBe('production')
    expect(r.source).toBe('NODE_ENV')
    // no environments.production overlay -> base list retained
    expect(r.enabledActions).toEqual(['base_action'])
    expect(r.line).toBe('environment: production (via NODE_ENV)')
  })
})
