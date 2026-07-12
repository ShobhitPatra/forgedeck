import { prisma, parseFilters } from '../../../lib/analytics'

/**
 * @agent description Returns aggregate document counts for the analytics dashboard.
 */
export async function GET(req: Request) {
  // forgedeck dogfood: this fixture is diffed on every PR (see .github/workflows/forgedeck-diff.yml).
  const filters = parseFilters(new URL(req.url).searchParams)
  const rows = await prisma.client.document.findMany({ where: filters })
  return Response.json(rows)
}
