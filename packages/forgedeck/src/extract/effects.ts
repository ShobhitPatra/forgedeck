import type { Effect } from '../ir/types.js'

const WRITE_OPS = 'create|createMany|update|updateMany|upsert|delete|deleteMany'
const READ_OPS = 'findMany|findUnique|findFirst|count|aggregate|groupBy'

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function classifyEffect(
  bodyText: string,
  opts: { method?: string },
): { effect: Effect; entitiesTouched: string[] } {
  // prisma and db cover the two dominant client naming conventions (grill patch Q2);
  // type resolved client detection (tx, ctx.db, custom names) is Plan 2 scope
  const writes = [
    ...bodyText.matchAll(new RegExp(`\\b(?:prisma|db)\\.(\\w+)\\.(?:${WRITE_OPS})\\b`, 'g')),
  ]
  const reads = [
    ...bodyText.matchAll(new RegExp(`\\b(?:prisma|db)\\.(\\w+)\\.(?:${READ_OPS})\\b`, 'g')),
  ]
  const entities = [...new Set([...writes, ...reads].map((m) => cap(m[1])))]

  if (writes.length > 0) return { effect: 'write', entitiesTouched: entities }

  const method = opts.method?.toUpperCase()
  if (method && method !== 'GET') return { effect: 'write', entitiesTouched: entities }
  if (reads.length > 0) return { effect: 'read', entitiesTouched: entities }
  if (method === 'GET') return { effect: 'read', entitiesTouched: [] }
  return { effect: 'write', entitiesTouched: [] }
}
