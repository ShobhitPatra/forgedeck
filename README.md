# forgedeck

**Compile your app into an MCP server.**

Modern applications are built for humans. AI agents interact with them by scraping HTML, executing JavaScript, and guessing workflows. Applications expose _implementation_, not _intent_.

Forgedeck is a compiler that translates applications into machine-understandable semantics. Point it at your Next.js repo and it emits:

- **`.agent/` bundle** — a navigable Markdown tree describing your app's entities, actions, and effects, plus a `tools.json` manifest
- **A runnable MCP server** — stdio, standalone HTTP, or served by your own app at `/api/mcp`
- **A coverage report with a scope verdict** — what the compiler understood, what it skipped and why, and an honest `SCOPE: IN / PARTIAL / OUT` line telling you whether your app is inside the supported surface at all

```bash
npx forgedeck init
```

Because it runs in your build path, the semantic layer is regenerated on every build — always in sync with your code, never a hand-written integration drifting out of date. That is the entire bet: **zero authoring, zero maintenance, never stale.**

## No LLM in the core — by design

Forgedeck's compiler contains no LLM anywhere. Semantics are either **derived** (deterministic static analysis: route handlers, server actions, zod contracts, Prisma entities, call-graph effect classification, auth boundaries) or **written by you** (JSDoc `@agent` annotations). Nothing is guessed, nothing needs an API key, CI never makes a model call, and a build is reproducible byte-for-byte.

## Safety by default

- Every action carries an effect class: `read | write | irreversible`.
- Mutating tools are **emitted disabled**. Enabling one takes an explicit per-action allowlist in `forgedeck.config.ts` — code describes, config authorizes.
- Server actions are reachable only through opt-in, transparent bridge routes (`/api/.agent/*`) whose generated code is checked into your repo.
- Unknown auth means locked. The `/api/mcp` route is an invisible 404 until you configure a token.

## What you get

| Surface               | How                                                                             |
| --------------------- | ------------------------------------------------------------------------------- |
| Build-time compile    | `withForgedeck()` Next.js plugin (never breaks your build) or `forgedeck build` |
| In-app MCP endpoint   | `createForgedeckHandler()` — 3 lines in an App Router route                     |
| Standalone server     | `forgedeck serve` (stdio or HTTP), official Docker sidecar image                |
| Semantic diffs in PRs | GitHub Action posts an IR-level diff comment (silent when nothing changed)      |
| Public storefront     | separate pruned bundle exposing only unauthenticated reads                      |
| Scaffolding           | `forgedeck init`                                                                |

## Supported scope (deliberately narrow)

Current wedge: **Next.js apps whose surface is REST route handlers (App Router + `pages/api`) and server actions.** Inside that scope the compiler extracts typed input contracts from zod schemas (named, inline, handler-local, or passed through wrapper helpers), query parameters, request bodies, Prisma entities, and effect/auth classifications.

Out of scope today, tracked openly: tRPC procedure extraction ([#72](https://github.com/ShobhitPatra/forgedeck/issues/72)), headless-backend data surfaces ([#73](https://github.com/ShobhitPatra/forgedeck/issues/73)). The compile tells you when you're out of scope — the `SCOPE` verdict exists so the tool says "I can't help you yet" instead of emitting a thin, useless surface.

## How it works

```
Your app (Next.js)
   ↓  static extraction   — routes, server actions, zod contracts, entities,
   |                        call-graph effects, auth boundaries (deterministic)
   ↓  annotations         — JSDoc @agent tags, only where derivation falls short
Semantic IR
   ↓
.agent/ bundle · MCP server · coverage report + scope verdict
```

## Honesty note

Forgedeck is developed against a pre-registered, one-shot benchmark ([OperateBench](https://github.com/operatebench)) that compares compiled bundles against browser-driving agents and hand-written MCP servers on real self-hosted apps — with kill criteria declared before each run and results published however they land. The current scope fence and roadmap order come directly from what that benchmark found.

## Status

Early, private development. Not yet released.

## License

Apache-2.0
