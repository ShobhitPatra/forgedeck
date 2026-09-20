import { prisma } from '@flatdb/database'

export async function GET() {
  return Response.json(await prisma.gadget.findMany())
}
