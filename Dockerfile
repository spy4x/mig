# Build stage — deno + nodejs.
FROM denoland/deno:debian-2.9.5 AS build

# Build identifier. Wired through to the runtime ENV so mig can render
# it in the footer. Pass at build time:
#   docker build --build-arg MIG_VERSION=$(git rev-parse --short HEAD) .
# Defaults to "dev" — see AGENTS.md "Build version".
ARG MIG_VERSION=dev

WORKDIR /src

# Install unzip + nodejs + npm (used by vite during build).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip nodejs npm \
    && npm install -g npm@^11.0.0 \
    && rm -rf /var/lib/apt/lists/*

# Bring in source.
COPY deno.json ./
COPY . .

# Workaround: delete deno.lock before npm install runs — deno.lock's
# presence makes npm v11 throw "Tracker idealTree already exists".
RUN rm -f deno.lock

# Pull deps via npm in an empty /tmp dir so there's no project context
# to confuse the resolver. --omit=optional skips optional platform binaries.
#
# IMPORTANT: this `mv` step assumes /src/node_modules is empty. The
# host's node_modules must not be carried into the build context —
# it's excluded via .dockerignore. If it ever leaks back in (e.g.
# someone adds a host that doesn't honour .dockerignore), the npm
# tree merges with the Deno `manual`-layout host tree, vite resolves
# preact via two paths, and Preact's `vnode.type === S` Fragment
# check silently fails at render time. Symptom: 77-byte HTML
# responses with empty <body> on every page route. Don't remove the
# dockerignore entries without a replacement.
RUN mkdir /tmp/npm-install && cd /tmp/npm-install && \
    npm install --no-save --ignore-scripts --no-audit --no-fund \
      --omit=optional \
      vite@^7.1.3 \
      @tailwindcss/vite@^4.1.18 \
      tailwindcss@^4.1.18 \
      preact@^10.29.1 \
      @preact/signals@^2.9.0 \
      nodemailer@^7.0.0 && \
    mv node_modules /src/node_modules && \
    cd /src && rm -rf /tmp/npm-install

# Bring in JSR-only deps (zod, @std/*, fresh core) into deno's cache.
RUN deno install --allow-scripts || true

# Build the SSR + client bundle via Vite.
RUN deno task build

# Runtime — deno:debian + ca-certs for SMTP TLS.
FROM denoland/deno:debian-2.9.5

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only what's needed at runtime. The Vite-bundled _fresh/ is
# self-contained for HTTP serving; node_modules only needed for the
# Tailwind/Vite processing at build time.
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

# Run via deno serve with the prebuilt bundle. Falls back to deno run
# main.ts if the bundle path is missing (developer mode).
CMD deno serve -A --port=${PORT} _fresh/server.js
