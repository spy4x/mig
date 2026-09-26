// Starts the standalone binary that `deno task compile` wrote (./mig) and
// checks that it actually serves mig: the booking page, /embed, /health
// and a static file. Exits non-zero on any failure, so CI catches a binary
// that builds but serves nothing.
//
//   deno task compile && deno task smoke:binary
//
// The binary runs with placeholder configuration only, a throwaway data
// file and a cleared environment. HOSTNAME is set to a name that resolves
// nowhere, because Docker and many shells export it: an entry point that
// binds to it would fail here instead of in someone's deployment.

const ROOT = new URL("../", import.meta.url);
const BINARY = new URL(Deno.build.os === "windows" ? "mig.exe" : "mig", ROOT);

const CHECKS: { path: string; contains: string }[] = [
  { path: "/", contains: "Jane Doe" },
  { path: "/embed", contains: "Jane Doe" },
  { path: "/health", contains: "ok" },
  { path: "/styles.css", contains: "{" },
];

async function main(): Promise<void> {
  const tmp = await Deno.makeTempDir({ prefix: "mig-smoke-binary-" });
  const port = freePort();
  const base = `http://127.0.0.1:${port}`;
  let server: Deno.ChildProcess | null = null;
  try {
    server = new Deno.Command(BINARY, {
      cwd: tmp,
      clearEnv: true,
      env: {
        HOSTNAME: "nowhere.invalid",
        HOST_NAME: "Jane Doe",
        HOST_EMAIL: "jane@example.com",
        HOST_TZ: "Europe/Berlin",
        MEETING_URL: "https://video.example.com/jane-doe",
        WEEKLY_AVAILABILITY: "MON-FRI 09:00-17:00",
        SLOT_DURATION_MIN: "30",
        CANCEL_SECRET: "placeholder-placeholder-placeholder",
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: "2525",
        SMTP_USER: "jane@example.com",
        SMTP_PASSWORD: "placeholder",
        SMTP_FROM: "Bookings <book@example.com>",
        PUBLIC_URL: "https://meet.example.com",
        PORT: String(port),
        DATA_PATH: `${tmp}/bookings.json`,
      },
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    await waitForHealth(base, server);
    for (const { path, contains } of CHECKS) {
      const res = await fetch(`${base}${path}`);
      const body = await res.text();
      if (!res.ok) throw new Error(`${path} answered ${res.status}`);
      if (!body.includes(contains)) {
        throw new Error(
          `${path} (${body.length} bytes) does not contain "${contains}"`,
        );
      }
      console.log(`ok ${path} ${res.status} ${body.length} bytes`);
    }
  } finally {
    if (server) {
      try {
        server.kill("SIGTERM");
      } catch {
        // Already exited.
      }
      await server.status;
    }
    await Deno.remove(tmp, { recursive: true });
  }
}

function freePort(): number {
  const l = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (l.addr as Deno.NetAddr).port;
  l.close();
  return port;
}

async function waitForHealth(
  base: string,
  server: Deno.ChildProcess,
): Promise<void> {
  let exited = false;
  server.status.then(() => exited = true);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error("the binary exited before it became healthy");
    try {
      const res = await fetch(`${base}/health`);
      await res.body?.cancel();
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("the binary did not answer /health within 30 s");
}

await main();
