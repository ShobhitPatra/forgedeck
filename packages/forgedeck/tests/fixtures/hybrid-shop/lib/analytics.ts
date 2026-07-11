import { prisma as rawPrisma } from './db'

export const prisma = { client: rawPrisma }

export function parseFilters(_q: unknown) {
  return {}
}
