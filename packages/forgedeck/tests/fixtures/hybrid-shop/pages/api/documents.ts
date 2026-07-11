import type { NextApiRequest, NextApiResponse } from 'next'
import { createDocumentSchema } from '../../lib/schemas'
import { prisma } from '../../lib/db'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const docs = await prisma.document.findMany()
    return res.json(docs)
  }
  if (req.method === 'POST') {
    const body = createDocumentSchema.parse(req.body)
    const doc = await prisma.document.create({
      data: { title: body.title, ownerId: 'u1', id: 'd1' },
    })
    return res.status(201).json(doc)
  }
  res.status(405).end()
}
