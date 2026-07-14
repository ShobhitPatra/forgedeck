import { describe, expect, it } from 'vitest'
import { heroSubheadline, proofStats, stalenessLine } from '../content/stats'

const DEFAULT_SUB = 'One line of config. Nothing hand-written.'

describe('heroSubheadline (spec §2: number only if multiplier clears 2x)', () => {
  it('returns the default when multiplier is null', () => {
    expect(
      heroSubheadline({ multiplier: null, efficiencyDivisor: null, stalenessDays: null }),
    ).toBe(DEFAULT_SUB)
  })
  it('returns the default when multiplier is below 2', () => {
    expect(heroSubheadline({ multiplier: 1.8, efficiencyDivisor: 4, stalenessDays: 90 })).toBe(
      DEFAULT_SUB,
    )
  })
  it('carries exactly one measured number at >=2x', () => {
    const sub = heroSubheadline({ multiplier: 2.4, efficiencyDivisor: null, stalenessDays: null })
    expect(sub).toContain('2.4×')
    expect(sub).toContain('measured')
  })
})

describe('proofStats (spec §4: slots, not promises)', () => {
  it('is empty pre-verdict', () => {
    expect(proofStats({ multiplier: null, efficiencyDivisor: null, stalenessDays: null })).toEqual(
      [],
    )
  })
  it('emits only the stats that exist', () => {
    const tiles = proofStats({ multiplier: 2.4, efficiencyDivisor: null, stalenessDays: null })
    expect(tiles).toHaveLength(1)
    expect(tiles[0].value).toBe('2.4×')
  })
})

describe('stalenessLine', () => {
  it('is null pre-verdict', () => {
    expect(
      stalenessLine({ multiplier: null, efficiencyDivisor: null, stalenessDays: null }),
    ).toBeNull()
  })
})
