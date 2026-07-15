import { describe, expect, it } from 'vitest'
import pkg from '../../../packages/forgedeck/package.json'
import { version } from '../lib/version'

describe('nav version single-sourcing', () => {
  it('mirrors the forgedeck package version, not a hardcoded string', () => {
    expect(version).toBe(pkg.version)
  })

  it('is a semver-shaped string', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })
})
