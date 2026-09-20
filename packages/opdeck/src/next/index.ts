// The `opdeck/next` subpath: both doors of the Next.js integration.
//   - withOpdeck()          — the build-time plugin (sync + tracing + voice).
//   - createOpdeckHandler() — the runtime MCP route handler (locked by default).
export * from './plugin.js'
export * from './handler.js'
