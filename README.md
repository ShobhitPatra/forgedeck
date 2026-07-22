# forgedeck

**Compile your Next.js app into an MCP server.**

forgedeck reads your routes, server actions, and schemas at build time and emits the contract agents need to operate your app: which actions exist, what inputs they take, which ones are safe to touch. Deterministic extraction — no LLM in the loop, nothing guessed.

```bash
npx forgedeck init
```

## What a build gives you

- **`.agent/` bundle** — a readable Markdown tree describing every action your app exposes. Check it into your repo. Review it like code.
- **A live MCP endpoint** — your app serves its own agent surface at `/api/mcp`. No separate server to deploy, nothing new to run.
- **A coverage report** — see exactly what the compiler understood, with evidence for every claim it makes. If your app isn't supported yet, it says so plainly instead of emitting a thin surface.

Because it runs in your build path, the agent surface is regenerated on every build — always in sync with your code.

## How it works

forgedeck reads your source the way the TypeScript compiler does — nothing runs, nothing is guessed. Two passes:

1. **Derive.** It walks every route handler and server action and works out what each one is: its name, the inputs it expects (from your zod schemas and request handling), whether it reads or writes data, and what auth stands in front of it. Each conclusion is recorded with the evidence behind it.
2. **Annotate.** Where the code alone can't express intent — a better description, a precondition worth stating — you add a JSDoc `@agent` comment next to the handler. Annotations always take precedence over derived facts.

```
Your app (Next.js)
   ↓  derive     — routes, server actions, schemas, effects, auth
   ↓  annotate   — @agent comments, only where you want to say more
   ↓
.agent/ bundle · MCP server · coverage report
```

## What you get

| Surface               | How                                                                             |
| --------------------- | ------------------------------------------------------------------------------- |
| Build-time compile    | `withForgedeck()` Next.js plugin (never breaks your build) or `forgedeck build` |
| In-app MCP endpoint   | `createForgedeckHandler()` — 3 lines in an App Router route                     |
| Standalone server     | `forgedeck serve` (stdio or HTTP), official Docker sidecar image                |
| Semantic diffs in PRs | GitHub Action posts an IR-level diff comment (silent when nothing changed)      |
| Public storefront     | separate pruned bundle exposing only unauthenticated reads                      |
| Scaffolding           | `forgedeck init`                                                                |

## Locked by default

- Every action is labeled `read`, `write`, or `irreversible`. The label travels with the tool.
- Mutations ship disabled. You enable them one by one, by exact name. No wildcards, ever.
- Unconfigured endpoints return 404. Without a token, your agent surface is invisible.
- Your app's own auth still runs on every request. forgedeck never bypasses it.

## What's supported

Next.js apps built on route handlers (App Router or `pages/api`) and server actions. tRPC ([#72](https://github.com/ShobhitPatra/forgedeck/issues/72)) and headless backends ([#73](https://github.com/ShobhitPatra/forgedeck/issues/73)) are next — the compiler tells you honestly when your app is outside what it can handle today.

## Measured, not promised

forgedeck is developed against [OperateBench](https://github.com/operatebench/operatebench) — an open benchmark asking whether AI agents can operate real web apps. We built it and pre-registered the methodology before running it, and results publish however they land.

## Status

Early development. Version 0.x.

## License

Apache-2.0
