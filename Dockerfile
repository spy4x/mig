# Build stage — multi-stage for small prod image.
FROM denoland/deno:alpine-2.5.0 AS build

WORKDIR /src

# Cache deps separately from source for faster rebuilds.
COPY deno.json deno.lock* ./
RUN deno install --allow-scripts

# Bring in source + static assets
COPY . .

# Vite production build → _fresh/server.js
RUN deno task build

# Compile the build into a single binary for minimal runtime image.
RUN deno compile -A --output /out/mig ./_fresh/server.js

# Runtime stage — distroless for minimal attack surface.
FROM gcr.io/distroless/cc-debian12:nonroot

COPY --from=build /out/mig /usr/local/bin/mig
COPY --from=build /src/static /app/static

WORKDIR /app

ENV PORT=8080
EXPOSE 8080

# JSON file is mounted as a volume in compose.
ENV DATA_PATH=/data/bookings.json

USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/mig"]
