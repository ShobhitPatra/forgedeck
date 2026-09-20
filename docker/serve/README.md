# opdeck MCP sidecar image

The official container that turns a compiled `.agent` bundle into a live MCP server —
for teams who cannot (or would rather not) add opdeck to the app itself. It runs
opdeck's standalone HTTP MCP transport (`serve --http`): the **same** locked-by-default
token gate, the same streamable-HTTP transport, and the same tool set as the in-app
Next route, with no Next dependency.

Because it is an official, versioned image, our fixes reach you through a tag bump —
not a hand-rolled Dockerfile drifting in your repo.

## Locked by default

- `OPDECK_MCP_TOKEN` **unset** → every request is an empty `404`. Adding the sidecar
  exposes nothing until you opt in.
- Wrong / missing `Authorization: Bearer <token>` → `404`.
- Exact bearer match → the MCP surface is served.

## Public storefront opt-out

If the mounted bundle ships a pruned `.agent-public/` storefront (built from a
`public:` config), the sidecar serves it to **unauthenticated** callers by default —
the token still gates the full internal surface. To turn that anonymous surface off for
a given deployment without rebuilding, set `OPDECK_PUBLIC=0`: the sidecar then
ignores any discovered `.agent-public/` and unauthenticated callers get the empty `404`
again. Any other value (or leaving it unset) keeps the default — a built storefront is
served. This lets one image decide per environment whether the storefront is live.

## Compose example

```yaml
services:
  opdeck:
    image: opdeck-serve # or ghcr.io/opdeck/serve:<tag> once published
    ports: ['8976:8976']
    volumes: ['./.agent:/bundle:ro'] # the compiled bundle, mounted read-only
    environment:
      TARGET_URL: http://app:3000 # your running app
      OPDECK_MCP_TOKEN: ${OPDECK_MCP_TOKEN} # unlock the surface
      # Optional: inject credentials into every proxied request (JSON object of headers)
      OPDECK_TARGET_HEADERS: '{"authorization":"Bearer ${UPSTREAM_TOKEN}"}'
```

Point your MCP client at `http://localhost:8976/` with the header
`Authorization: Bearer <OPDECK_MCP_TOKEN>`.

On SELinux hosts (Fedora, RHEL) the read-only bind mount needs a relabel or the
container is denied access to the bundle — use `:ro,Z` instead of `:ro` (compose:
`['./.agent:/bundle:ro,Z']`).

## Building locally

Build context is `packages/opdeck`; pack the package into it first:

```sh
pnpm --filter opdeck build
(cd packages/opdeck && npm pack)   # emits opdeck-<version>.tgz
docker build -f docker/serve/Dockerfile -t opdeck-serve packages/opdeck
```

The image installs only the four production dependencies (no build toolchain, no dev
deps, no source tree) — see the size note in the PR. Publishing to a public registry
(ghcr) is deferred to the launch plan.
