import { describe, expect, it } from 'vitest'
import pkg from '../../../packages/opdeck/package.json'
import { version } from '../lib/version'

describe('nav version single-sourcing', () => {
  it('mirrors the opdeck package version, not a hardcoded string', () => {
    expect(version).toBe(pkg.version)
  })

  it('is a semver-shaped string', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })
})
