import { prisma } from '@workspace/database'

export async function GET() {
  return Response.json(await prisma.widget.findMany())
}
