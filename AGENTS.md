# AGENTS.md

Instructions for coding agents working in this repository.

## What this repo is

**forgedeck** — a compiler that translates Next.js apps into machine-understandable semantics for AI agents: a Semantic IR, an `.agent/` bundle (Markdown tree + `tools.json`), a runnable MCP server, and a coverage report with a scope verdict. See `README.md` for the product surface.

## Layout

- `packages/forgedeck/` — the compiler. `src/extract/` (static analysis: routes, pages-api, server actions, inputs, effects, auth, entities, annotations, unwrapping), `src/ir/` (types, names, verdict), `src/emit/` (bundle, tools, bridges, coverage, public), `src/mcp/` (`core.ts` is the transport-agnostic brain; stdio wrapper in `server.ts`), `src/next/` (plugin + in-app route handler), `src/cli/` (commander wiring only — commands parse, call, print; no logic).
- `apps/web/` — the landing site (Next.js, Tailwind v4, Fumadocs at `/docs`).
- `docs/` — **gitignored planning area. Never commit anything under it.** Only `AGENTS.md`, `CLAUDE.md`, and `README.md` belong in git as documentation.

## Commands (run from the repo root)

```bash
pnpm -C packages/forgedeck test        # vitest, ~16s, must be green
pnpm -C packages/forgedeck typecheck   # tsc --noEmit
pnpm lint                              # oxlint
pnpm format:check                      # prettier (fix with: pnpm format)
```

All four are the merge gate. Husky + lint-staged run prettier/oxlint on commit.

## Conventions

- **Commit messages:** `type(scope): description` — one line, lowercase, no attribution or Co-Authored-By lines, no symbols beyond comma/colon.
- **Workflow:** branch per task → PR with a What/Why body (Why weighted) → squash merge.
- **TDD:** write the failing test, observe it fail, then implement. Tests live in `packages/forgedeck/tests/`, fixture apps in `tests/fixtures/*-shop/` — extend fixtures **additively only**; several tests assert exact action counts, so adding a fixture route means updating those counts deliberately.
- **Buy-don't-build:** ts-morph for AST work, the official MCP SDK for serving. Novel code is extraction + IR + emitters only.
- **Verify against reality, not just fixtures.** Extraction changes that matter should be spot-checked by compiling a real app (clone one into a temp dir outside the repo) and inspecting the emitted `tools.json`/`coverage.txt`. Fixture-green does not mean fixed.

## Safety pillars (do not weaken)

- Every action carries `effect: read | write | irreversible`. `enabled` is `effect === 'read'` at extraction; **nothing else may enable a tool** except the explicit per-action allowlist in `forgedeck.config.ts` (exact names, no wildcards). Inputs/descriptions are metadata and must never influence enablement or auth.
- Unknown auth classifies as locked. Effect classification errs conservative: unresolved calls on non-GET default to `write`; relaxations must be evidence-marked and scoped (see the GET relaxation and telemetry handling in `src/extract/effects.ts`).
- The compiler contains **no LLM** and must never gain a network dependency. Builds are deterministic; `withForgedeck()` never breaks a user's build (config validation errors are the sole deliberate exception).
- Generated code checked into user repos (bridge shims) is wiring, never logic.

## Scope fence

Supported surface: REST route handlers (App Router + `pages/api`) and server actions. tRPC (#72) and headless-backend ingestion (#73) are out of scope until their issues land — do not partially implement them as a side effect of another change. The compile's `SCOPE:` verdict in `coverage.txt` is the honest boundary; keep it honest.
