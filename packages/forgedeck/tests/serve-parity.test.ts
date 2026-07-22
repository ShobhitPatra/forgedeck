import { describe, it, expect } from 'vitest'
import { compile } from '../src/compile'
import { toToolsManifest } from '../src/emit/tools'
import { buildToolHandlers } from '../src/mcp/core'

// Regression net for the "papermark class" of bug: an emitted manifest lists a
// tool as `enabled`, but the serving side never registers a handler for it, so an
// agent sees the tool advertised yet gets a silent no-op or crash when it calls.
// This asserts, for every compile-able fixture app, that the set of enabled tool
// names in the emitted manifest is EXACTLY the set of names `buildToolHandlers`
// registers — no more (dead handlers), no less (dropped tools). `buildToolHandlers`
// only constructs handler closures here; nothing is ever invoked, so this needs no
// network and is fully deterministic.
//
// `flatdb-shop` and `workspace-shop` are pnpm-workspace fixtures whose Next.js app
// lives at `apps/web`, not at the fixture root (`compile()` on the bare root fails
// with "no nextjs surfaces found" — see tests/compile.test.ts and tests/entities.test.ts
// for the same convention). `session-shop` (added in task 3) is included alongside
// the brief's original list.
const FIXTURES = [
  'tests/fixtures/mini-shop',
  'tests/fixtures/hybrid-shop',
  'tests/fixtures/flatdb-shop/apps/web',
  'tests/fixtures/workspace-shop/apps/web',
  'tests/fixtures/collision-shop',
  'tests/fixtures/session-shop',
]

describe('serve/emit parity', () => {
  for (const dir of FIXTURES) {
    it(`every enabled tool in ${dir} is served`, async () => {
      const ir = await compile(dir)
      const manifest = toToolsManifest(ir)
      const handlers = buildToolHandlers(manifest, 'http://x')
      const enabled = manifest.tools
        .filter((t) => t.enabled)
        .map((t) => t.name)
        .sort()
      expect([...handlers.keys()].sort()).toEqual(enabled)
    })
  }
})
