import type { NextApiRequest, NextApiResponse } from 'next'
import { prisma } from '../../lib/db'

function withAuth(fn: (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>) {
  return fn
}

async function teamsHandler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const teams = await prisma.user.findMany()
    return res.json(teams)
  }
  res.status(405).end()
}
export default withAuth(teamsHandler)
