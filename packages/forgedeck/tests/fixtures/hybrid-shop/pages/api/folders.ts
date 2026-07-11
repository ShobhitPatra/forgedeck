import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../lib/db'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const folders = await prisma.document.findMany()
    return res.json(folders)
  } else if (req.method === 'POST') {
    const folder = await prisma.document.create({ data: { id: 'f1', title: 'x', ownerId: 'u1' } })
    return res.status(201).json(folder)
  } else {
    res.status(405).end()
  }
}
