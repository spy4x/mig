# Self-hosting mig

How to run mig with Docker, Docker Compose or as a standalone binary, and how to
put it behind a reverse proxy. Every setting is listed in
[configuration.md](configuration.md).

## Docker

```bash
docker run -d --name mig \
  -p 8080:8080 \
  -v ./data:/data:z \
  -e HOST_NAME="Jane Doe" \
  -e HOST_EMAIL="jane@example.com" \
  -e HOST_TZ="Europe/Berlin" \
  -e MEETING_URL="https://meet.google.com/abc-defg-hij" \
  -e WEEKLY_AVAILABILITY="MON-FRI 09:00-17:00" \
  -e SLOT_DURATION_MIN=30 \
  -e MIN_NOTICE_HOURS=6 \
  -e SMTP_HOST=smtp.example.com \
  -e SMTP_PORT=587 \
  -e SMTP_USER=jane@example.com \
  -e SMTP_PASSWORD='change-me' \
  -e SMTP_FROM="Bookings <book@example.com>" \
  -e CANCEL_SECRET=$(openssl rand -base64 32) \
  -e PUBLIC_URL=https://meet.example.com \
  antonshubin/mig:latest
```

The container runs as `deno`, uid/gid 1993 — not root. `./data` must be writable
by that uid. Create it yourself first — `docker run` would otherwise create a
missing bind-mount source owned by root, which neither the default user nor
`--user` below could write to — then make it writable:

```bash
mkdir -p ./data
sudo chown 1993:1993 ./data
```

`chown`ing to a different uid needs root, hence `sudo`; a plain `chown` as your
own user fails with "Operation not permitted". If you'd rather not use `sudo`
(on regular, rootful Docker), run the container as your own user instead — this
works because you created `./data` yourself above, so you already own it:

```bash
mkdir -p ./data
docker run --user "$(id -u):$(id -g)" ...
```

The `chown 1993:1993` step also assumes rootful Docker — rootless Podman remaps
container uids to a different host range, so `chown 1993:1993` is meaningless
there, and plain `--user` alone fails with "Permission denied". On rootless
Podman, add `--userns=keep-id` too:

```bash
mkdir -p ./data
podman run --userns=keep-id --user "$(id -u):$(id -g)" ...
```

A **new, empty** Docker named volume (`-v mig-data:/data` instead of a host
path) needs neither step — Docker creates it owned by `deno` already, since
`/data` inside the image is. A named volume already used by mig before this
change is still owned by root; see the CHANGELOG's 0.4.0 upgrade note for the
fix.

The `:z` on the bind mount above relabels `./data` for SELinux (Fedora, RHEL and
derivatives) so the container is allowed to read and write it at all — without
it, a host with SELinux enforcing rejects the access with the same "Permission
denied" the uid mismatch above produces, even once the uid/gid ownership is
correct. It's a no-op, and safe to leave in, on a host that doesn't run SELinux.
`:z` relabels the _entire_ directory for container access, so only use it on a
folder that belongs to mig alone — never a home directory, `/srv`, or `/etc`.

## Docker Compose

```yaml
services:
  mig:
    image: antonshubin/mig:latest
    container_name: mig
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ./data:/data:z
    environment:
      HOST_NAME: "Jane Doe"
      HOST_EMAIL: "jane@example.com"
      HOST_TZ: "Europe/Berlin"
      MEETING_URL: "https://meet.google.com/abc-defg-hij"
      WEEKLY_AVAILABILITY: "MON-FRI 09:00-17:00"
      SLOT_DURATION_MIN: "30"
      MIN_NOTICE_HOURS: "6"
      SMTP_HOST: "smtp.example.com"
      SMTP_PORT: "587"
      SMTP_USER: "jane@example.com"
      SMTP_PASSWORD: "change-me"
      SMTP_FROM: "Bookings <book@example.com>"
      CANCEL_SECRET: "change-me" # replace with the output of: openssl rand -base64 32
      PUBLIC_URL: "https://meet.example.com"
```

`./data` needs the same non-root fix as [Docker](#docker) above: create it first
(`mkdir -p ./data`), then `sudo chown 1993:1993 ./data`, or add a
`user: "1000:1000"` — your own uid/gid — line to the service instead (only works
if you created `./data` yourself first, same as above).

Every environment variable is listed in [configuration.md](configuration.md).

## Behind a reverse proxy

mig limits bookings per visitor address (`RATE_LIMIT_PER_5MIN`). By default the
address is the one the connection came from, and mig ignores every forwarding
header, because a client that connects directly can put any value in them.
Behind a reverse proxy, the connection comes from the proxy, so every visitor
shares the proxy's limit. Set `TRUSTED_PROXY_HEADER` to the one header your
proxy sets:

- `x-real-ip` — Traefik with default settings, or nginx with
  `proxy_set_header X-Real-IP $remote_addr`.
- `x-forwarded-for` — mig reads the first address in the list. Use it only when
  the proxy replaces the header, as Traefik does by default. A proxy that
  appends to it (nginx's `$proxy_add_x_forwarded_for`) keeps the client's own
  value first, so the client picks its own address.
- `cf-connecting-ip` — Cloudflare sets it on every request it forwards. Use it
  only when the server accepts connections from Cloudflare alone (a firewall
  limited to Cloudflare's addresses, or a Cloudflare Tunnel). A client that
  reaches the server directly can send any value, and Traefik passes the header
  through unchanged.

Behind Cloudflare, the connection that reaches Traefik comes from Cloudflare, so
Traefik's `X-Real-IP` and `X-Forwarded-For` hold Cloudflare's address, not the
visitor's. Use `cf-connecting-ip` there, and limit the server to Cloudflare.
Ports that Docker publishes bypass ufw's and firewalld's INPUT rules, so a
Cloudflare-only rule for a container belongs in the `DOCKER-USER` chain, or in
Traefik (an IP allow-list on the router), not in the host firewall's usual
rules.

Name a header your proxy does not set, and a client can pick a new address for
every request and never be limited. When the trusted header is missing from a
request, mig falls back to the connection's address.

## Compile (standalone binary)

```bash
deno install
deno task compile
./mig
```

`deno task compile` builds the app and packs it, with the Deno runtime, into one
file, `./mig`, about 105 MB (almost all of it the Deno runtime). It needs
nothing else installed. It reads the same environment variables as the Docker
image, and stores bookings at `DATA_PATH` (default `./data/bookings.json`,
relative to the directory you start it from). It is built for the machine you
run the task on; CI builds the Linux x86-64 one on every push and checks that it
serves the booking page.
