# CLAUDE.md

## Project

**forgedeck** — a compiler that translates web applications into machine-understandable semantics for AI agents. Ingests a Next.js (App Router) repo; emits a Semantic IR, an `.agent/` bundle (Markdown tree + `tools.json`), a runnable MCP server, and a coverage report. Pitch: "compile your app into an MCP server."

## Hard rules

- **Never run any git command (commit, push, init, clone, remote, anything) without asking Shobhit first.** Every git operation needs explicit permission, every time.
- **Never commit spec or plan files.** Only `AGENTS.md`, `CLAUDE.md`, and `README.md` belong in git. All planning artifacts live locally under `docs/` (gitignored).
- The design spec lives at `docs/superpowers/specs/2026-07-10-semantic-compiler-design.md` — read it before making architectural decisions.

## Architecture pillars (from the approved spec)

- **Three tiers:** deterministic static extraction → build-time LLM inference (cached in `agent.lock`; merged lockfile diff = human ratification) → developer annotations. `--no-inference` (tier 1 only) is a first-class mode.
- **MCP is an output adapter, never a competitor.** The Semantic IR is the durable asset; adapters are replaceable.
- **Safety defaults:** mutating tools emitted disabled (per-action allowlist); unratified semantics never authorize mutation; every action carries `effect: read | write | irreversible`.
- **Bridge routes** (`/api/.agent/*`) for server actions are opt-in and fully transparent — generated code is checked into the user's repo.

## Conventions

- Buy-don't-build: ts-morph for AST work, official MCP SDK for the server. Novel code = extraction + IR + emitters only.
- When spawning subagents for search/research/vetting, use Sonnet or Opus — never Fable.
