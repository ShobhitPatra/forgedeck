import { prisma } from '../lib/db'

export const GET = async () => Response.json(await prisma.document.findMany())

export async function POST() {
  const doc = await prisma.document.create({ data: { id: 'r1', title: 'r', ownerId: 'u1' } })
  return Response.json(doc, { status: 201 })
}
