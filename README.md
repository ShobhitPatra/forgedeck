# opdeck

**Make your Next.js app agent-ready.**

opdeck is a compiler. It reads your route handlers, server actions and schemas at build time and emits the MCP tools an AI agent needs to operate your app. Every mutation stays locked until you allow it by name. There is no LLM in the loop, so nothing is guessed and every build is reproducible.

## What goes in, what comes out

This handler:

```ts
// app/api/orders/[id]/route.ts

/**
 * Cancel an order and delete its record.
 * @agent effect irreversible
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return new Response(null, { status: 401 })
  const { id } = await params
  await db.order.delete({ where: { id } })
  return new Response(null, { status: 204 })
}
```

compiles to this tool. The output below is the compiler's, unedited:

```json
{
  "name": "delete_orders_by_id",
  "description": "Cancel an order and delete its record.",
  "inputSchema": {
    "type": "object",
    "properties": { "id": { "type": "string" } },
    "required": ["id"]
  },
  "kind": "route",
  "method": "DELETE",
  "path": "/api/orders/{id}",
  "effect": "irreversible",
  "auth": "required",
  "enabled": false
}
```

The name and input came from the route. The description came from your JSDoc. `auth: required` came from the session check. `enabled: false` is the default for anything that is not a read.

## What a build gives you

| Output           | What it is                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `.agent/` bundle | A Markdown tree and a `tools.json` describing every action your app exposes. Check it in and review it like code.                         |
| MCP endpoint     | Your app serves its own agent surface at `/api/mcp`. No separate server to deploy.                                                        |
| Coverage report  | What the compiler understood, with the evidence behind each claim, and a plain `SCOPE` verdict when your app is outside what it supports. |

The bundle is regenerated on every build, so it cannot drift from your code.

## Locked by default

- Every action is labeled `read`, `write` or `irreversible`. The label travels with the tool.
- Mutations ship disabled. You enable them one at a time, by exact name, in `opdeck.config.ts`. There are no wildcards.
- With no token configured, `/api/mcp` returns an empty 404. The surface is invisible until you turn it on.
- Your app's own auth runs on every request. opdeck never bypasses it.
- Code describes, config authorizes. Descriptions and inputs are metadata and never affect what is enabled.

## How it works

opdeck reads your source the way the TypeScript compiler does. Nothing runs.

1. **Derive.** It walks every route handler and server action and works out the name, the inputs (from your zod schemas and request handling), whether the action reads or writes, and what auth stands in front of it. Each conclusion is recorded with its evidence.
2. **Annotate.** Where code alone cannot express intent, you add a JSDoc `@agent` tag next to the handler. Annotations always take precedence over derived facts, and an annotation can only make an effect stricter, never looser.

## Try it

opdeck is not on npm yet. Until the first release, run it from source against any Next.js app:

```bash
git clone https://github.com/ShobhitPatra/opdeck
cd opdeck
pnpm install
pnpm -C packages/opdeck build
node packages/opdeck/dist/cli/index.js build /path/to/your/next-app --out /tmp/agent
```

Read `/tmp/agent/coverage.txt` first. It tells you what was understood and what was skipped.

## Surfaces

| Surface               | How                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------ |
| Build-time compile    | `withOpdeck()` Next.js plugin, which never breaks your build, or `opdeck build`      |
| In-app MCP endpoint   | `createOpdeckHandler()`, three lines in an App Router route                          |
| Standalone server     | `opdeck serve` over stdio or HTTP, with a Docker sidecar image                       |
| Semantic diffs in PRs | A GitHub Action that comments an IR-level diff and stays silent when nothing changed |
| Public surface        | A separate pruned bundle exposing only unauthenticated reads                         |
| Setup                 | `opdeck init` writes the route, wraps `next.config`, and scaffolds the config        |

## What is supported

Next.js apps built on route handlers (App Router or `pages/api`) and server actions.

Not supported yet: tRPC ([#72](https://github.com/ShobhitPatra/opdeck/issues/72)) and headless backends behind a Next.js storefront ([#73](https://github.com/ShobhitPatra/opdeck/issues/73)). When your app is out of scope the compiler says so in the coverage report instead of emitting a thin surface.

## Status

Early development, version 0.x, one maintainer. Interfaces will change. If you want to know when the first release lands, [join the waitlist](https://opdeckdev.vercel.app).

## License

Apache-2.0
