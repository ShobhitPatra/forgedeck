import type { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { updateSettingsSchema } from '../../lib/schemas'
import { prisma } from '../../lib/db'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession()
  if (!session) return res.status(401).end()
  if (req.method !== 'PUT') return res.status(405).end()
  const body = updateSettingsSchema.parse(req.body)
  const user = await prisma.user.update({ where: { id: 'u1' }, data: { email: body.email } })
  res.json(user)
}
