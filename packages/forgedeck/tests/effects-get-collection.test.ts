// Regression for the papermark `get_teams`/read-GET-family drop (OperateBench:
// present in tools.json but not servable). DIAGNOSIS (compiled papermark @2e17e3c0):
// the unservable read GETs were NOT unresolved-call misclassifications. 17 of the 18
// external-only GET-writes were demoted by exactly one chain:
//   `effect write via log -> postJsonWithTimeout -> fetch (external webhook)`
// papermark's `log` (lib/utils) is a fire-and-forget Slack telemetry logger called in
// catch blocks. The effects scanner follows `log` into its POST `fetch`, the external
// taxonomy tags a `webhook` write, and `resolveEffect` returns `write` -> the route
// emits `enabled:false` and the serve layer never registers it.
//
// RED (before the fix): `get_whoami` below reads `prisma.product.findMany` but calls
// `log(...)` in its catch; classifyEffect discovers the telemetry webhook and returns
// `effect:'write'`, so `enabled` is false. GREEN (after): a telemetry logger call is
// recognized under the GET relaxation and recorded as `telemetry call log, unverified`
// instead of a webhook write, so the GET classifies `read` and enables.
//
// NOTE ON papermark's `get_teams` specifically: its GET branch ALSO contains a genuine
// `prisma.team.create` (lazy default-team creation), so it stays `write` even after
// this fix — that is a correct classification, not a bug (see task report). This fix
// restores the ~16 read GETs whose ONLY write signal was the telemetry logger.
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { compile } from '../src/compile'
import { classifyEffect } from '../src/extract/effects'

describe('parameterless GET collection routes', () => {
  it('classifies a session+findMany GET whose only side effect is a telemetry logger as read and enables it', async () => {
    const ir = await compile('tests/fixtures/session-shop')
    const whoami = ir.actions.find((a) => a.name === 'get_whoami')
    expect(whoami).toBeDefined()
    expect(whoami!.effect).toBe('read')
    expect(whoami!.enabled).toBe(true)
  })
})

describe('telemetry logger relaxation (classifyEffect)', () => {
  function loaded(route: string) {
    const project = new Project({ useInMemoryFileSystem: true })
    project.createSourceFile(
      '/lib/log.ts',
      `const post = async (u: string, b: unknown) => fetch(u, { method: 'POST', body: JSON.stringify(b) })
       export const log = async (o: { message: string }) => post('https://hooks.slack', o)`,
    )
    return project.createSourceFile('/app/api/x/route.ts', route)
  }

  it('does not let a telemetry logger webhook demote a GET, recording it as unverified', () => {
    const sf = loaded(
      `import { log } from '../../../lib/log'
       export async function GET() {
         const rows = await prisma.product.findMany()
         try { return rows } catch (e) { log({ message: String(e) }) }
       }`,
    )
    const r = classifyEffect(sf.getFunction('GET')!.getBodyText()!, { method: 'GET', sf })
    expect(r.effect).toBe('read')
    expect(r.external).toEqual([])
    expect(r.evidence.join(' ')).toContain('telemetry call log, unverified')
    expect(r.evidence.join(' ')).toContain('effect read via prisma.product.findMany')
  })

  it('still demotes a GET that inlines its own POST fetch (relaxation is narrow to named loggers)', () => {
    const r = classifyEffect(
      `await fetch('https://api.example.com/mutate', { method: 'POST', body: '{}' })`,
      { method: 'GET' },
    )
    expect(r.effect).toBe('write')
    expect(r.external).toContain('webhook')
  })

  it('keeps a non-GET method with a telemetry logger conservatively write', () => {
    const sf = loaded(
      `import { log } from '../../../lib/log'
       export async function POST() { log({ message: 'x' }); return null }`,
    )
    const r = classifyEffect(sf.getFunction('POST')!.getBodyText()!, { method: 'POST', sf })
    expect(r.effect).toBe('write')
  })
})
