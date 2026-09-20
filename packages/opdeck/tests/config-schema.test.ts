import { describe, it, expect } from 'vitest'
import {
  defineConfig,
  parseConfig,
  resolveEnvironment,
  ConfigError,
  type OpdeckConfig,
} from '../src/config/schema'

describe('defineConfig', () => {
  it('is an identity function that returns its argument unchanged', () => {
    const cfg: OpdeckConfig = { enabledActions: ['post_documents'] }
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

  it('accepts `public: true` (the auto-curated storefront)', () => {
    expect(parseConfig({ public: true }).public).toBe(true)
  })

  it('accepts `public: { actions: [...] }` (explicitly named surface)', () => {
    expect(parseConfig({ public: { actions: ['get_health', 'post_orders'] } }).public).toEqual({
      actions: ['get_health', 'post_orders'],
    })
  })

  it('accepts a `public` override inside an environment block', () => {
    const parsed = parseConfig({
      public: true,
      environments: { staging: { public: { actions: ['get_health'] } } },
    })
    expect(parsed.environments!.staging.public).toEqual({ actions: ['get_health'] })
  })

  it('rejects a malformed `public` object shape (typo in `actions`)', () => {
    // A silently-empty safety allowlist is a safety bug: the strict shape must fail loudly.
    expect(() => parseConfig({ public: { action: ['get_health'] } })).toThrow(ConfigError)
    expect(() => parseConfig({ public: false })).toThrow(ConfigError)
    expect(() => parseConfig({ public: { actions: 'get_health' } })).toThrow(ConfigError)
  })

  it('allows an explicitly-undefined `public` key (storefront off)', () => {
    const parsed = parseConfig({ public: undefined })
    expect(parsed.public).toBeUndefined()
  })

  it('rejects wrong value types via the strict schema', () => {
    expect(() => parseConfig({ enabledActions: 'post_documents' })).toThrow(ConfigError)
    expect(() => parseConfig({ exclude: [1, 2] })).toThrow(ConfigError)
    expect(() => parseConfig('nope')).toThrow(/must be an object/)
  })
})

describe('resolveEnvironment', () => {
  const cfg: OpdeckConfig = {
    enabledActions: ['base_action'],
    environments: { staging: { enabledActions: ['staging_action'] } },
  }

  it('uses the base list when no env is selected', () => {
    const r = resolveEnvironment(cfg, {})
    expect(r.enabledActions).toEqual(['base_action'])
    expect(r.line).toBe('environment: base (via default)')
  })

  it('REPLACES the base list wholesale from the environment overlay', () => {
    const r = resolveEnvironment(cfg, { OPDECK_ENV: 'staging' })
    expect(r.enabledActions).toEqual(['staging_action'])
    expect(r.name).toBe('staging')
    expect(r.line).toBe('environment: staging (via OPDECK_ENV)')
  })

  it('prefers OPDECK_ENV over NODE_ENV', () => {
    const r = resolveEnvironment(cfg, { OPDECK_ENV: 'staging', NODE_ENV: 'production' })
    expect(r.source).toBe('OPDECK_ENV')
    expect(r.enabledActions).toEqual(['staging_action'])
  })

  it('falls back to NODE_ENV when OPDECK_ENV is unset', () => {
    const r = resolveEnvironment(cfg, { NODE_ENV: 'production' })
    expect(r.name).toBe('production')
    expect(r.source).toBe('NODE_ENV')
    // no environments.production overlay -> base list retained
    expect(r.enabledActions).toEqual(['base_action'])
    expect(r.line).toBe('environment: production (via NODE_ENV)')
  })

  it('carries the base `public` when no overlay replaces it', () => {
    const c: OpdeckConfig = { public: true, environments: { staging: {} } }
    expect(resolveEnvironment(c, {}).public).toBe(true)
    expect(resolveEnvironment(c, { OPDECK_ENV: 'staging' }).public).toBe(true)
  })

  it('REPLACES base `public` from the active environment overlay', () => {
    const c: OpdeckConfig = {
      public: true,
      environments: { staging: { public: { actions: ['get_health'] } } },
    }
    expect(resolveEnvironment(c, { OPDECK_ENV: 'staging' }).public).toEqual({
      actions: ['get_health'],
    })
    // base env keeps the base value
    expect(resolveEnvironment(c, {}).public).toBe(true)
  })
})
