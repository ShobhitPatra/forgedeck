# forgedeck

**Compile your app into an MCP server.**

Modern applications are built for humans. AI agents interact with them by scraping HTML, executing JavaScript, and guessing workflows — expensive, slow, and unreliable. Applications expose *implementation*, not *intent*.

Forgedeck is a compiler that translates applications into machine-understandable semantics. Point it at your codebase, run one command, and it emits:

- **`.agent/` bundle** — a navigable tree of Markdown describing your app's entities, actions, workflows, and effects, plus a `tools.json` manifest
- **A runnable MCP server** — so agents like Claude can correctly *operate* your app instead of reverse-engineering its DOM
- **A coverage report** — what the compiler understood, and the few places it needs your help

```bash
forgedeck build
```

Because it runs in your build path, the semantic layer is regenerated on every deploy — **always in sync with your code**, never a hand-written integration drifting out of date.

## Status

Early development. First target: Next.js (App Router). Not yet usable.

## How it works

```
Your app (Next.js)
   ↓  static extraction   — routes, schemas, entities, auth boundaries (deterministic)
   ↓  intent inference    — descriptions, effects, workflows (LLM-proposed, lockfile-cached, human-ratified)
   ↓  annotations         — only where inference falls short
Semantic IR
   ↓
.agent/ bundle · MCP server · coverage report
```

Safety by default: mutating actions are emitted disabled until explicitly allowlisted, and unreviewed inferences can never authorize a mutation.

## License

TBD
