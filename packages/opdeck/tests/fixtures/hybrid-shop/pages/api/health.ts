import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * @agent auth none
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return res.json({ ok: true })
  res.status(405).end()
}
export default handler
