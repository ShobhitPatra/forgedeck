import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../lib/db'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).end()
  }
  const view = await prisma.document.update({ where: { id: 'd1' }, data: { title: 'seen' } })
  res.json(view)
}
