# The official opdeck MCP sidecar.
#
# A container has no stdio peer, so this image serves the compiled `.agent` bundle
# over opdeck's standalone HTTP MCP transport (`serve --http`) — the SAME token
# gate, transport, and tool set the in-app Next route proves, with no Next dependency.
#
# Build context is `packages/opdeck`. Before building, run `pnpm build` then
# `npm pack` there so a `opdeck-<version>.tgz` (dist + package.json only, via the
# package's `files` field) sits in the context:
#
#   pnpm --filter opdeck build
#   (cd packages/opdeck && npm pack)
#   docker build -f docker/serve/Dockerfile -t opdeck-serve packages/opdeck
#
# We install the packed tarball globally, which pulls only the four production deps
# from npm — no build toolchain, no dev deps, no source tree.

FROM node:22-alpine

# Install the packed package globally. `npm install -g <tgz>` resolves prod deps from
# the registry and puts the `opdeck` bin on PATH.
COPY opdeck-*.tgz /tmp/opdeck.tgz
RUN npm install -g /tmp/opdeck.tgz && rm /tmp/opdeck.tgz

# The bundle is mounted read-only at /bundle; the app to drive comes from TARGET_URL.
# OPDECK_MCP_TOKEN gates the surface (unset => every request 404s — locked by
# default). OPDECK_TARGET_HEADERS optionally injects credentials into proxied calls.
ENV TARGET_URL=http://host.docker.internal:3000

# The HTTP MCP transport listens here.
EXPOSE 8976

# Shell form so $TARGET_URL is expanded at runtime.
ENTRYPOINT ["sh", "-c", "exec opdeck serve --http --port 8976 --bundle /bundle --target \"$TARGET_URL\""]
