export type BenchStats = {
  /** OperateBench task-success multiplier, bundle vs browser arm. */
  multiplier: number | null
  /** Cost/latency divisor, bundle vs browser arm. */
  efficiencyDivisor: number | null
  /** Staleness experiment window in days. */
  stalenessDays: number | null
}

/** Friday 2026-07-18 verdict fills this file. Nothing else changes. */
export const stats: BenchStats = {
  multiplier: null,
  efficiencyDivisor: null,
  stalenessDays: null,
}

const DEFAULT_SUB = 'One line of config. Nothing hand-written.'

export function heroSubheadline(s: BenchStats): string {
  if (s.multiplier !== null && s.multiplier >= 2) {
    return `Agents complete ${fmt(s.multiplier)}× more tasks on it — measured. One line of config.`
  }
  return DEFAULT_SUB
}

export function proofStats(s: BenchStats): { value: string; label: string }[] {
  const tiles: { value: string; label: string }[] = []
  if (s.multiplier !== null) {
    tiles.push({
      value: `${fmt(s.multiplier)}×`,
      label: 'more tasks completed than clicking through the UI',
    })
  }
  if (s.efficiencyDivisor !== null) {
    tiles.push({ value: `1/${fmt(s.efficiencyDivisor)}`, label: 'of the cost and latency' })
  }
  return tiles
}

export function stalenessLine(s: BenchStats): string | null {
  if (s.stalenessDays === null) return null
  return `In our staleness experiment, hand-written bindings degraded after ${s.stalenessDays} days of app drift. Compiled bundles regenerated on the next build.`
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
