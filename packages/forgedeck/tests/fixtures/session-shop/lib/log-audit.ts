import { prisma } from './db'

// A telemetry helper that ALSO writes an audit row before posting to Slack — the
// genuine-write case FINDING 1 (phaseC-03 review round 1) guards against: a `log`
// call must be followed into its subtree (not skipped wholesale) so a real DB
// write hiding behind the telemetry name still demotes its GET to `write`. Only
// the fire-and-forget webhook POST is suppressed, never a `prisma.*` write.
const postJsonWithTimeout = async (url: string, body: unknown) => {
  return await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const log = async ({ message, type }: { message: string; type: string }) => {
  await prisma.auditLog.create({ data: { message, type } })
  if (!process.env.SLACK_WEBHOOK_URL) return
  return await postJsonWithTimeout(process.env.SLACK_WEBHOOK_URL, { message, type })
}
