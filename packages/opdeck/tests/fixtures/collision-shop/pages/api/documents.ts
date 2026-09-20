import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../lib/db'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const docs = await prisma.document.findMany()
    return res.json(docs)
  } else if (req.method === 'POST') {
    const doc = await prisma.document.create({ data: { id: 'd1' } })
    return res.status(201).json(doc)
  } else {
    res.status(405).end()
  }
}
