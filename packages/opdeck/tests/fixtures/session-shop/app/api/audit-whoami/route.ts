import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '../../../lib/db'
import { log } from '../../../lib/log-audit'

// Same session+findMany read shape as whoami/route.ts, but this route's telemetry
// `log` helper (lib/log-audit.ts) ALSO writes a genuine `prisma.auditLog.create`
// before its Slack POST. The GET must still classify `write` and stay disabled —
// only the webhook signal inside a telemetry subtree is suppressed, not DB writes.
export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const products = await prisma.product.findMany()
    return NextResponse.json({ products })
  } catch (error) {
    log({ message: `audit whoami failed: ${String(error)}`, type: 'error' })
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
