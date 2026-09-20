import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../../lib/db'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query
  if (req.method === 'DELETE') {
    await prisma.document.delete({ where: { id: String(id) } })
    return res.status(204).end()
  }
  const doc = await prisma.document.findUnique({ where: { id: String(id) } })
  res.json(doc)
}
