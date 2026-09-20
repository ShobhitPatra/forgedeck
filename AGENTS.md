# AGENTS.md

Instructions for coding agents working in this repository.

## What this repo is

**opdeck** — a compiler that translates Next.js apps into machine-understandable semantics for AI agents: a Semantic IR, an `.agent/` bundle (Markdown tree + `tools.json`), a runnable MCP server, and a coverage report with a scope verdict. See `README.md` for the product surface.

## Architecture pillars

- **Two tiers, no LLM:** deterministic static extraction (derive) → developer annotations (JSDoc `@agent`, always take precedence). The compiler has no LLM and no network dependency anywhere; builds are reproducible. (The originally-planned build-time inference tier is shelved by design decision, not deferral.)
- **MCP is an output adapter, never a competitor.** The Semantic IR is the durable asset; adapters are replaceable.
- **Safety defaults:** every action carries `effect: read | write | irreversible`; mutating tools are emitted disabled; enabling one takes the explicit per-action allowlist in `opdeck.config.ts` (exact names, no wildcards) — code describes, config authorizes. Unknown auth means locked. Inputs and descriptions are metadata and must never influence enablement or auth.
- **Bridge routes** (`/api/.agent/*`) for server actions are opt-in and fully transparent — generated code is checked into the user's repo, and it is wiring, never logic.

## Layout

- `packages/opdeck/` — the compiler. `src/extract/` (static analysis: routes, pages-api, server actions, inputs, effects, auth, entities, annotations, unwrapping), `src/ir/` (types, names, verdict), `src/emit/` (bundle, tools, bridges, coverage, public), `src/mcp/` (`core.ts` is the transport-agnostic brain; stdio wrapper in `server.ts`), `src/next/` (plugin + in-app route handler), `src/cli/` (commander wiring only — commands parse, call, print; no logic).
- `apps/web/` — the landing site (Next.js, Tailwind v4, Fumadocs at `/docs`).
- `docs/` — gitignored planning area.

## Commands (run from the repo root)

```bash
pnpm -C packages/opdeck test        # vitest, ~16s, must be green
pnpm -C packages/opdeck typecheck   # tsc --noEmit
pnpm lint                              # oxlint
pnpm format:check                      # prettier (fix with: pnpm format)
```

All four are the merge gate. Husky + lint-staged run prettier/oxlint on commit.

## Scope fence

Supported surface: REST route handlers (App Router + `pages/api`) and server actions. tRPC (#72) and headless-backend ingestion (#73) are out of scope until their issues land — do not partially implement them as a side effect of another change. The compile's `SCOPE:` verdict in `coverage.txt` is the honest boundary; keep it honest.
