# Build stage — deno + nodejs.
FROM denoland/deno:debian-2.9.5 AS build

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

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider -q http://localhost:${PORT}/health || exit 1

CMD deno serve -A --unstable-temporal --port=${PORT} _fresh/server.js
