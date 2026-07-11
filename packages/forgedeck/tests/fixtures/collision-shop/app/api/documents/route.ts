import { prisma } from '../../../lib/db'

export async function GET() {
  const docs = await prisma.document.findMany()
  return Response.json(docs)
}

export async function POST() {
  const doc = await prisma.document.create({ data: { id: 'd1' } })
  return Response.json(doc)
}
