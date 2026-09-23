# Build stage.
FROM denoland/deno:debian-2.9.5 AS build

# Build identifier. Wired through to the runtime ENV so mig can render
# it in the footer. Pass at build time:
#   docker build --build-arg MIG_VERSION=$(git rev-parse --short HEAD) .
# Defaults to "dev" — see AGENTS.md "Build version".
ARG MIG_VERSION=dev

WORKDIR /src

COPY . .

# nodeModulesDir is "manual" in deno.json, so deno install must run
# before any task that touches TypeScript. --frozen fails instead of
# silently rewriting deno.lock when it no longer matches deno.json —
# the same guarantee CI's own `deno install --frozen` step already
# gives (see AGENTS.md, CI), so the image is built from the exact
# dependency versions CI tested, not from a separate npm resolution.
RUN deno install --frozen

# Build the SSR + client bundle via Vite.
RUN deno task build

# Runtime — deno:debian + ca-certs for SMTP TLS.
FROM denoland/deno:debian-2.9.5

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only what's needed at runtime. The Vite-bundled _fresh/ is
# self-contained for HTTP serving; the node_modules `deno install`
# builds in the build stage is needed only for the Tailwind/Vite
# processing at build time, not at runtime.
COPY --from=build /src/_fresh ./_fresh
COPY --from=build /src/static ./static

ENV PORT=8080
EXPOSE 8080
ENV DATA_PATH=/data/bookings.json
# Build identifier — re-declare ARG in this stage so the runtime ENV
# can pick it up. AGENTS.md "Build version" has the injection recipe.
ARG MIG_VERSION=dev
ENV MIG_VERSION=${MIG_VERSION}

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider -q http://localhost:${PORT}/health || exit 1

# Run via deno serve with the prebuilt bundle.
CMD deno serve -A --port=${PORT} _fresh/server.js
