import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

// THE SKELETON E2E (plan 4, task 3) — deploy-shaped proof that the plugin +
// route pair works through a real `next build` / `next start`:
//
//   1. copy the mini-shop fixture to a throwaway dir (the committed fixture is
//      FROZEN), install the packed forgedeck tarball into it;
//   2. wrap next.config.js with withForgedeck() (CJS require of the ESM package
//      — Node >= 22 require(esm)) and drop the 3-line /api/mcp shim;
//   3. `next build` THROUGH the plugin: the voice prints exactly once (the
//      worker-process fix), `.agent/` is emitted, and the route's .nft.json
//      traces the bundle for serverless deploys;
//   4. `next start` with FORGEDECK_MCP_TOKEN: the MCP initialize handshake
//      succeeds over HTTP with the bearer token, and the no-token posture is an
//      empty 404.
//
// Gated behind RUN_E2E=1: it shells out to npm/next (network for the tarball's
// deps, minutes of build time), so CI skips it. Run locally with:
//   pnpm build && RUN_E2E=1 pnpm vitest run tests/skeleton-e2e.test.ts
const runE2E = process.env.RUN_E2E === '1'

// vitest runs with cwd at the package root (same convention as e2e.test.ts).
const PKG_ROOT = process.cwd()
const FIXTURE = join(PKG_ROOT, 'tests', 'fixtures', 'mini-shop')
const PORT = 3106
const TOKEN = randomBytes(24).toString('hex')

const SETUP_TIMEOUT = 600_000
const TEST_TIMEOUT = 120_000

function initializeBody(): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'skeleton-e2e', version: '0' },
    },
    id: 1,
  })
}

async function postMcp(headers: Record<string, string>): Promise<Response> {
  return fetch(`http://localhost:${PORT}/api/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: initializeBody(),
  })
}

describe.runIf(runE2E)(
  'skeleton e2e: withForgedeck + createForgedeckHandler, deploy-shaped',
  () => {
    let appDir: string
    let buildOutput: string
    let server: ChildProcess | undefined

    beforeAll(() => {
      expect(
        existsSync(join(PKG_ROOT, 'dist', 'next', 'index.js')),
        'dist/ missing — run `pnpm build` before RUN_E2E=1',
      ).toBe(true)

      // 1. Throwaway copy of the frozen fixture, installed FRESH. (Copying the
      // fixture's existing node_modules looks faster but yields a duplicated-React
      // "invalid hook call" crash when `next build` prerenders /404 — npm must
      // resolve the tree for THIS directory.)
      appDir = mkdtempSync(join(tmpdir(), 'fd-skeleton-'))
      for (const entry of readdirSync(FIXTURE)) {
        if (entry === '.next' || entry === 'node_modules' || entry === 'package-lock.json') continue
        cpSync(join(FIXTURE, entry), join(appDir, entry), { recursive: true })
      }
      rmSync(join(appDir, 'prisma', 'dev.db'), { force: true })
      execFileSync('npm', ['install'], { cwd: appDir, stdio: 'pipe' })

      // 2. Pack a LEAN forgedeck tarball (a temporary .npmignore keeps tests/ and
      // src/ — with their nested fixture node_modules — out of the pack) and
      // install it into the copy.
      const npmignore = join(PKG_ROOT, '.npmignore')
      writeFileSync(npmignore, 'tests/\nsrc/\ndocs/\n*.tsbuildinfo\n')
      let tarball: string
      try {
        const packed = execFileSync('npm', ['pack', '--json'], { cwd: PKG_ROOT, encoding: 'utf8' })
        tarball = join(PKG_ROOT, JSON.parse(packed)[0].filename)
      } finally {
        unlinkSync(npmignore)
      }
      try {
        execFileSync('npm', ['install', tarball], { cwd: appDir, stdio: 'pipe' })
      } finally {
        unlinkSync(tarball)
      }

      // 3. Wire the two doors: the plugin wrap (CJS require — the interop the
      // fixture actually ships with) and the route shim.
      writeFileSync(
        join(appDir, 'next.config.js'),
        `const { withForgedeck } = require('forgedeck/next')\n\nmodule.exports = withForgedeck({})\n`,
      )
      mkdirSync(join(appDir, 'app', 'api', 'mcp'), { recursive: true })
      writeFileSync(
        join(appDir, 'app', 'api', 'mcp', 'route.ts'),
        `import { createForgedeckHandler } from 'forgedeck/next'\n\nexport const { GET, POST } = createForgedeckHandler()\n`,
      )

      // 4. next build THROUGH the plugin.
      buildOutput = execFileSync('npx', ['next', 'build'], {
        cwd: appDir,
        encoding: 'utf8',
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
      })
    }, SETUP_TIMEOUT)

    afterAll(() => {
      server?.kill('SIGTERM')
      if (appDir) rmSync(appDir, { recursive: true, force: true })
    })

    it('prints the build voice exactly once (main process only, never per worker)', () => {
      const voices = buildOutput.split('\n').filter((l) => l.startsWith('forgedeck ✓'))
      expect(voices).toHaveLength(1)
      expect(voices[0]).toMatch(
        /^forgedeck ✓ \d+ actions \(\d+ reads enabled, \d+ mutations locked\)/,
      )
    })

    it('emits the bundle and does not warn about its own mcp shim', () => {
      expect(existsSync(join(appDir, '.agent', 'tools.json'))).toBe(true)
      expect(buildOutput).not.toContain(
        'wrapped route handler not resolved: createForgedeckHandler',
      )
    })

    it('traces .agent/** into the /api/mcp route (serverless deploys ship the bundle)', () => {
      const nft = JSON.parse(
        readFileSync(
          join(appDir, '.next', 'server', 'app', 'api', 'mcp', 'route.js.nft.json'),
          'utf8',
        ),
      ) as { files: string[] }
      expect(nft.files.some((f) => f.endsWith('.agent/tools.json'))).toBe(true)
    })

    it(
      'serves the MCP initialize handshake over HTTP with the token; 404s without',
      async () => {
        server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
          cwd: appDir,
          env: {
            ...process.env,
            FORGEDECK_MCP_TOKEN: TOKEN,
            PORT: String(PORT),
            NEXT_TELEMETRY_DISABLED: '1',
          },
          stdio: 'ignore',
        })
        // Wait for the server to accept connections.
        let up = false
        for (let i = 0; i < 60 && !up; i++) {
          try {
            await fetch(`http://localhost:${PORT}/`)
            up = true
          } catch {
            await new Promise((r) => setTimeout(r, 500))
          }
        }
        expect(up, `next start did not come up on :${PORT}`).toBe(true)

        // Locked-by-default: no token -> empty 404 (indistinguishable from no route).
        const locked = await postMcp({})
        expect(locked.status).toBe(404)
        expect(await locked.text()).toBe('')

        // Wrong token -> same empty 404.
        const wrong = await postMcp({ authorization: 'Bearer nope' })
        expect(wrong.status).toBe(404)

        // Correct bearer -> a real MCP initialize result from the app's own route.
        const ok = await postMcp({ authorization: `Bearer ${TOKEN}` })
        expect(ok.status).toBe(200)
        const body = (await ok.json()) as {
          result?: { serverInfo?: { name?: string }; protocolVersion?: string }
        }
        expect(body.result?.serverInfo?.name).toBe('forgedeck mini-shop')
        expect(body.result?.protocolVersion).toBeTruthy()
      },
      TEST_TIMEOUT,
    )
  },
)
