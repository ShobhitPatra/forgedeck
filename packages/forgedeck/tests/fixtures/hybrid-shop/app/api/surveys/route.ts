import { withV1Wrapper } from '../../../lib/wrappers'
import { prisma } from '../../../lib/db'

export const GET = withV1Wrapper({
  handler: async () => Response.json(await prisma.document.findMany()),
})
