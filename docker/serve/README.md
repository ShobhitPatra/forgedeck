# forgedeck MCP sidecar image

The official container that turns a compiled `.agent` bundle into a live MCP server —
for teams who cannot (or would rather not) add forgedeck to the app itself. It runs
forgedeck's standalone HTTP MCP transport (`serve --http`): the **same** locked-by-default
token gate, the same streamable-HTTP transport, and the same tool set as the in-app
Next route, with no Next dependency.

Because it is an official, versioned image, our fixes reach you through a tag bump —
not a hand-rolled Dockerfile drifting in your repo.

## Locked by default

- `FORGEDECK_MCP_TOKEN` **unset** → every request is an empty `404`. Adding the sidecar
  exposes nothing until you opt in.
- Wrong / missing `Authorization: Bearer <token>` → `404`.
- Exact bearer match → the MCP surface is served.

## Compose example

```yaml
services:
  forgedeck:
    image: forgedeck-serve # or ghcr.io/forgedecklabs/serve:<tag> once published
    ports: ['8976:8976']
    volumes: ['./.agent:/bundle:ro'] # the compiled bundle, mounted read-only
    environment:
      TARGET_URL: http://app:3000 # your running app
      FORGEDECK_MCP_TOKEN: ${FORGEDECK_MCP_TOKEN} # unlock the surface
      # Optional: inject credentials into every proxied request (JSON object of headers)
      FORGEDECK_TARGET_HEADERS: '{"authorization":"Bearer ${UPSTREAM_TOKEN}"}'
```

Point your MCP client at `http://localhost:8976/` with the header
`Authorization: Bearer <FORGEDECK_MCP_TOKEN>`.

On SELinux hosts (Fedora, RHEL) the read-only bind mount needs a relabel or the
container is denied access to the bundle — use `:ro,Z` instead of `:ro` (compose:
`['./.agent:/bundle:ro,Z']`).

## Building locally

Build context is `packages/forgedeck`; pack the package into it first:

```sh
pnpm --filter forgedeck build
(cd packages/forgedeck && npm pack)   # emits forgedeck-<version>.tgz
docker build -f docker/serve/Dockerfile -t forgedeck-serve packages/forgedeck
```

The image installs only the four production dependencies (no build toolchain, no dev
deps, no source tree) — see the size note in the PR. Publishing to a public registry
(ghcr) is deferred to the launch plan.
