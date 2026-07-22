import type { CoverageItem, ScopeVerdict } from './types.js'

// Placement note: this lives in its own module (not compile.ts, not types.ts)
// because both need it — types.ts's validateIR falls back to computing a verdict
// for pre-verdict IR shapes (see below), and compile.ts computes it for every
// fresh build. A function in either file would force the other into a circular
// value import. compile.ts re-exports this so `import { computeScopeVerdict }
// from './compile.js'` (as called out in the task brief) keeps working.

// Bucket each skip by FIRST match: trpc, then wrapped, then other.
type Bucket = 'trpc' | 'wrapped' | 'other'

function bucketOf(item: CoverageItem): Bucket {
  const reason = item.reason.toLowerCase()
  if (reason.includes('trpc') || item.file.includes('/api/trpc/')) return 'trpc'
  if (reason.includes('wrapped')) return 'wrapped'
  return 'other'
}

/**
 * The machine-honest scope fence, derived purely from extraction coverage counts
 * (never from LLM inference) so it holds even in --no-inference builds.
 *
 * Rules (verbatim from the task brief):
 * - extractedRatio = extracted / (extracted + skipped.length); 1 when both are 0.
 * - status is 'out' if extractedRatio < 0.5, OR the trpc bucket has >= 1 item AND
 *   extractedRatio < 0.8; 'in' if extractedRatio >= 0.8 (and not out-ruled above);
 *   else 'partial'.
 * - dominantSkipReasons: bucket names with >= 1 item, ordered by bucket size desc.
 */
export function computeScopeVerdict(extracted: number, skipped: CoverageItem[]): ScopeVerdict {
  const total = extracted + skipped.length
  const extractedRatio = total === 0 ? 1 : extracted / total

  const counts: Record<Bucket, number> = { trpc: 0, wrapped: 0, other: 0 }
  for (const item of skipped) counts[bucketOf(item)]++

  const dominantSkipReasons = (Object.keys(counts) as Bucket[])
    .filter((b) => counts[b] > 0)
    .sort((a, b) => counts[b] - counts[a])

  let status: ScopeVerdict['status']
  if (extractedRatio < 0.5 || (counts.trpc >= 1 && extractedRatio < 0.8)) status = 'out'
  else if (extractedRatio >= 0.8) status = 'in'
  else status = 'partial'

  return { status, extractedRatio, dominantSkipReasons }
}
