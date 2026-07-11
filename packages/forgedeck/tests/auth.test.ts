import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { loadProject } from '../src/load/project'
import { compile } from '../src/compile'
import {
  detectHandlerAuth,
  detectWrapperAuth,
  loadMiddlewareMatchers,
  matcherCovers,
  resolveAuth,
} from '../src/extract/auth'

function fileFrom(code: string) {
  const project = new Project({ useInMemoryFileSystem: true })
  return project.createSourceFile('/x.ts', code)
}

describe('detectHandlerAuth session idioms', () => {
  it('flags getServerSession imported from next-auth as required', () => {
    const sf = fileFrom(`
      import { getServerSession } from 'next-auth'
      export default async function handler(req, res) {
        const session = await getServerSession()
        if (!session) return res.status(401).end()
        res.json({})
      }
    `)
    const r = detectHandlerAuth(sf.getFunctions()[0].getBodyText()!, sf)
    expect(r.auth).toBe('required')
    expect(r.evidence.join(' ')).toContain('getServerSession')
  })

  it('flags an unguarded idiom as required (conservative)', () => {
    const sf = fileFrom(`
      import { currentUser } from '@clerk/nextjs/server'
      export default async function handler() {
        const user = await currentUser()
        return Response.json(user)
      }
    `)
    const r = detectHandlerAuth(sf.getFunctions()[0].getBodyText()!, sf)
    expect(r.auth).toBe('required')
    expect(r.evidence.join(' ')).toContain('currentUser')
  })

  it('detects auth() and getUser idioms', () => {
    const authSf = fileFrom(`
      import { auth } from 'next-auth'
      export default async function handler() { const s = await auth(); return Response.json(s) }
    `)
    expect(detectHandlerAuth(authSf.getFunctions()[0].getBodyText()!, authSf).auth).toBe('required')
    const supaSf = fileFrom(`
      import { getUser } from '@supabase/ssr'
      export default async function handler() { const u = await getUser(); return Response.json(u) }
    `)
    expect(detectHandlerAuth(supaSf.getFunctions()[0].getBodyText()!, supaSf).auth).toBe('required')
  })

  it('returns unknown when the idiom name is present but not imported from an auth source', () => {
    const sf = fileFrom(`
      function getServerSession() { return null }
      export default async function handler() {
        const session = getServerSession()
        return Response.json(session)
      }
    `)
    const r = detectHandlerAuth(sf.getFunctions()[0].getBodyText()!, sf)
    expect(r.auth).toBe('unknown')
    expect(r.evidence).toEqual([])
  })

  it('returns unknown when no idiom is present', () => {
    const r = detectHandlerAuth(`const x = await prisma.user.findMany(); return res.json(x)`)
    expect(r.auth).toBe('unknown')
    expect(r.evidence).toEqual([])
  })
})

describe('detectWrapperAuth', () => {
  it('flags auth-shaped wrapper names as required', () => {
    for (const name of [
      'withAuth',
      'withApiAuth',
      'withTeam',
      'withUser',
      'withSession',
      'withAdmin',
    ]) {
      const r = detectWrapperAuth(name)
      expect(r.auth).toBe('required')
      expect(r.evidence.join(' ')).toContain(`wrapper ${name}`)
    }
  })
  it('leaves non-auth wrappers unknown', () => {
    expect(detectWrapperAuth('withValidation').auth).toBe('unknown')
    expect(detectWrapperAuth('nextConnect').auth).toBe('unknown')
  })
})

describe('middleware matchers', () => {
  const matchers = loadMiddlewareMatchers(loadProject('tests/fixtures/hybrid-shop'))

  it('parses config.matcher from middleware.ts', () => {
    expect(matchers.map((m) => m.pattern).sort()).toEqual([
      '/api/admin/:path*',
      '/api/reports/:path*',
    ])
  })
  it('covers a route path under a :path* matcher', () => {
    expect(matcherCovers(matchers, '/api/reports/{reportId}')).toBe('/api/reports/:path*')
    expect(matcherCovers(matchers, '/api/admin/stats')).toBe('/api/admin/:path*')
  })
  it('does not cover unrelated paths', () => {
    expect(matcherCovers(matchers, '/api/folders')).toBeUndefined()
    expect(matcherCovers(matchers, '/api/billing')).toBeUndefined()
  })
})

describe('resolveAuth resolution order', () => {
  const matchers = loadMiddlewareMatchers(loadProject('tests/fixtures/hybrid-shop'))

  it('lets handler-level required win over everything', () => {
    const r = resolveAuth(
      { auth: 'required', evidence: ['auth required via getServerSession in handler'] },
      '/api/folders',
      matchers,
    )
    expect(r.auth).toBe('required')
    expect(r.evidence.join(' ')).toContain('getServerSession')
  })
  it('falls back to middleware coverage', () => {
    const r = resolveAuth({ auth: 'unknown', evidence: [] }, '/api/reports/{reportId}', matchers)
    expect(r.auth).toBe('required')
    expect(r.evidence.join(' ')).toContain('middleware matcher /api/reports/:path*')
  })
  it('yields unknown when no signal exists (never none)', () => {
    const r = resolveAuth({ auth: 'unknown', evidence: [] }, '/api/folders', matchers)
    expect(r.auth).toBe('unknown')
    expect(r.evidence).toEqual([])
  })
})

describe('auth integration on fixtures', () => {
  const hybrid = compile('tests/fixtures/hybrid-shop')
  const mini = compile('tests/fixtures/mini-shop')

  it('put_settings is required via getServerSession', () => {
    const a = hybrid.actions.find((x) => x.name === 'put_settings')!
    expect(a.auth).toBe('required')
    expect(a.evidence.join(' ')).toContain('getServerSession')
  })
  it('get_teams is required via the withAuth wrapper', () => {
    const a = hybrid.actions.find((x) => x.name === 'get_teams')!
    expect(a.auth).toBe('required')
    expect(a.evidence.join(' ')).toContain('wrapper withAuth')
  })
  it('get_reports_by_report_id is required via the middleware matcher', () => {
    const a = hybrid.actions.find((x) => x.name === 'get_reports_by_report_id')!
    expect(a.auth).toBe('required')
    expect(a.evidence.join(' ')).toContain('middleware matcher /api/reports/:path*')
  })
  it('mini-shop get_products stays unknown (no auth signals)', () => {
    const a = mini.actions.find((x) => x.name === 'get_products')!
    expect(a.auth).toBe('unknown')
  })
  it('never derives none', () => {
    for (const a of [...hybrid.actions, ...mini.actions]) expect(a.auth).not.toBe('none')
  })
  it('excludes the nextauth catch-all plumbing route', () => {
    expect(hybrid.actions.some((a) => a.sourceFile.includes('[...nextauth]'))).toBe(false)
    expect(hybrid.coverage.skipped).toContainEqual({
      file: 'pages/api/auth/[...nextauth].ts',
      reason: 'auth plumbing route, excluded',
    })
  })
})
