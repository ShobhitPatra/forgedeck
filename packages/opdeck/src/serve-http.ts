import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { handleMcpRequest, type CreateOpdeckHandlerOptions } from './next/handler.js'

// The standalone HTTP MCP sidecar. A container has no stdio peer, so the official
// image serves the SAME MCP surface over a plain node http server instead — no Next
// dependency. Each request is adapted to a web-standard Fetch `Request`, handed to
// the ONE shared `handleMcpRequest` pipeline (identical token gate, identical
// transport, identical tools as the in-app route), and its `Response` is written back
// onto the node `ServerResponse`. The glue is intentionally minimal: buffer the body,
// copy headers, pass the raw Request through.

/**
 * Adapt a node `IncomingMessage` into a web-standard Fetch `Request`.
 *
 * The URL is reconstructed from the request path plus the `Host` header (falling back
 * to `localhost`). Headers are copied verbatim (multi-value headers preserved). The
 * body is fully buffered for non-GET/HEAD methods — MCP JSON-RPC payloads are small,
 * and buffering sidesteps the `duplex: 'half'` streaming dance. GET/HEAD carry no body
 * (a Fetch `Request` with a GET body throws).
 */
export async function nodeToFetchRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? 'localhost'
  const url = new URL(req.url ?? '/', `http://${host}`)

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) for (const v of value) headers.append(key, v)
    else headers.set(key, value)
  }

  const method = (req.method ?? 'GET').toUpperCase()
  let body: Blob | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    // Wrap the buffered bytes in a Blob — a BodyInit the DOM lib accepts without the
    // ArrayBufferLike generic friction of passing a raw Buffer/Uint8Array.
    if (chunks.length) body = new Blob([Buffer.concat(chunks)])
  }

  return new Request(url, { method, headers, body })
}

/**
 * Write a web-standard Fetch `Response` back onto a node `ServerResponse`: status line,
 * every header, then the body streamed through to completion. A null body (e.g. the
 * locked-door 404) ends cleanly with no bytes.
 */
export async function writeFetchResponse(response: Response, res: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  res.writeHead(response.status, headers)

  if (response.body) {
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
  }
  res.end()
}

export interface StartHttpMcpServerOptions {
  /** Port to listen on. `0` picks an ephemeral port (used by tests). */
  port: number
  /** Bundle directory (the compiled `.agent` dir containing tools.json). */
  bundleDir: string
  /** Base URL every proxied tool call is dispatched to. */
  targetUrl: string
  /** Host/interface to bind. Defaults to all interfaces (the container case). */
  host?: string
  /** @internal test seam — extra options threaded into `handleMcpRequest`
   * (e.g. an injected `manifest` so the server never touches the filesystem). */
  handlerOpts?: CreateOpdeckHandlerOptions
  /** @internal test seam — replace the whole request pipeline. */
  handler?: (request: Request) => Promise<Response>
}

export interface HttpMcpServerHandle {
  server: Server
  /** The actual bound port (resolved even when `port: 0` was requested). */
  port: number
  close(): Promise<void>
}

/**
 * Start the standalone HTTP MCP server and resolve once it is listening. The token
 * posture is identical to the in-app route (via the shared `handleMcpRequest`):
 * OPDECK_MCP_TOKEN unset -> every request is an empty 404; wrong/missing bearer ->
 * 404; exact match -> serve. An unexpected error inside the pipeline (e.g. a missing
 * bundle surfaced to an authorized caller) becomes a 500 rather than a hung socket.
 */
export function startHttpMcpServer(opts: StartHttpMcpServerOptions): Promise<HttpMcpServerHandle> {
  const handle =
    opts.handler ??
    ((request: Request) =>
      handleMcpRequest(request, {
        bundleDir: opts.bundleDir,
        targetUrl: opts.targetUrl,
        ...opts.handlerOpts,
      }))

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const request = await nodeToFetchRequest(req)
        const response = await handle(request)
        await writeFetchResponse(response, res)
      } catch (err) {
        console.error(`opdeck: HTTP MCP request failed: ${(err as Error).message}`)
        if (!res.headersSent) res.writeHead(500)
        res.end()
      }
    })()
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port, opts.host, () => {
      server.removeListener('error', reject)
      const port = (server.address() as AddressInfo).port
      console.error(
        `opdeck: MCP HTTP server listening on port ${port} (bundle ${opts.bundleDir}, target ${opts.targetUrl})`,
      )
      resolve({
        server,
        port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      })
    })
  })
}
