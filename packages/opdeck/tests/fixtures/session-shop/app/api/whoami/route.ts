import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '../../../lib/db'
import { log } from '../../../lib/log'

// Mirrors papermark's GET /api/teams read shape: a session-guarded collection read
// that, on failure, fires a telemetry `log(...)` (Slack webhook) inside the catch.
// The read is the endpoint's purpose; the log is observability, not a data write.
export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const products = await prisma.product.findMany()
    return NextResponse.json({ products })
  } catch (error) {
    log({ message: `whoami failed: ${String(error)}`, type: 'error' })
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
