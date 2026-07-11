// The `forgedeck/next` subpath: both doors of the Next.js integration.
//   - withForgedeck()          — the build-time plugin (sync + tracing + voice).
//   - createForgedeckHandler() — the runtime MCP route handler (locked by default).
export * from './plugin.js'
export * from './handler.js'
