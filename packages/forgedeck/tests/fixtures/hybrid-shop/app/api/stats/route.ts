import { prisma, parseFilters } from '../../../lib/analytics'

export async function GET(req: Request) {
  const filters = parseFilters(new URL(req.url).searchParams)
  const rows = await prisma.client.document.findMany({ where: filters })
  return Response.json(rows)
}
