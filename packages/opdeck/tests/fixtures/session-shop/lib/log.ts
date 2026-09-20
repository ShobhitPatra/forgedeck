// Fire-and-forget Slack telemetry logger, mirroring papermark's `lib/utils` `log`
// (log -> postJsonWithTimeout -> fetch POST). This posts diagnostics to an
// observability webhook, never user data — but the effects scanner follows the call
// chain and sees the POST `fetch`, which the external taxonomy tags as a webhook.
const postJsonWithTimeout = async (url: string, body: unknown) => {
  return await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const log = async ({ message, type }: { message: string; type: string }) => {
  if (!process.env.SLACK_WEBHOOK_URL) return
  return await postJsonWithTimeout(process.env.SLACK_WEBHOOK_URL, { message, type })
}
