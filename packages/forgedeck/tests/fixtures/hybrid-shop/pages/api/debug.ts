import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * @agent ignore
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return res.json({ debug: true })
  res.status(405).end()
}
