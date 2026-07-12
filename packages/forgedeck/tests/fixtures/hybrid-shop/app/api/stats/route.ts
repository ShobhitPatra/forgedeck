import { prisma, parseFilters } from '../../../lib/analytics'

/**
 * @agent description Returns aggregate document counts for the analytics reporting dashboard.
 */
export async function GET(req: Request) {
  const filters = parseFilters(new URL(req.url).searchParams)
  const rows = await prisma.client.document.findMany({ where: filters })
  return Response.json(rows)
}
