// Helpers for scripts that drive a local build of mig in a browser
// (scripts/screenshots.ts, scripts/embed-check.ts): an in-process SMTP
// sink, so a booking succeeds and no mail leaves the machine, a free
// port, and a wait for the server's /health.

export interface CapturedMail {
  to: string;
  raw: string;
}

/** Accepts every message on 127.0.0.1 and keeps it in memory. Speaks
 *  just enough SMTP for nodemailer: EHLO, AUTH (any credentials),
 *  MAIL, RCPT, DATA, RSET, NOOP, QUIT. No STARTTLS is offered, so
 *  nodemailer stays on plain TCP to localhost. */
export function startSmtpSink(): {
  port: number;
  mails: CapturedMail[];
  close(): void;
} {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const mails: CapturedMail[] = [];
  const serve = async () => {
    for await (const conn of listener) handle(conn).catch(() => {});
  };
  const handle = async (conn: Deno.Conn) => {
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const say = (line: string) => conn.write(enc.encode(`${line}\r\n`));
    let buf = "";
    let inData = false;
    let authLoginSteps = 0;
    let rcpt = "";
    await say("220 localhost mig local sink");
    const chunk = new Uint8Array(64 * 1024);
    while (true) {
      const n = await conn.read(chunk);
      if (n === null) break;
      buf += dec.decode(chunk.subarray(0, n));
      while (true) {
        if (inData) {
          const end = buf.indexOf(`\r\n.\r\n`);
          if (end === -1) break;
          mails.push({
            to: rcpt,
            raw: buf.slice(0, end).replaceAll(`\r\n..`, `\r\n.`),
          });
          buf = buf.slice(end + 5);
          inData = false;
          await say("250 OK queued");
          continue;
        }
        const eol = buf.indexOf(`\r\n`);
        if (eol === -1) break;
        const line = buf.slice(0, eol);
        buf = buf.slice(eol + 2);
        const verb = line.split(" ")[0].toUpperCase();
        if (authLoginSteps > 0) {
          authLoginSteps--;
          await say(
            authLoginSteps > 0 ? "334 UGFzc3dvcmQ6" : "235 Authenticated",
          );
        } else if (verb === "EHLO" || verb === "HELO") {
          await say("250-localhost");
          await say("250-AUTH PLAIN LOGIN");
          await say("250 8BITMIME");
        } else if (verb === "AUTH") {
          if (/^AUTH LOGIN\s*$/i.test(line)) {
            authLoginSteps = 2;
            await say("334 VXNlcm5hbWU6");
          } else if (/^AUTH LOGIN /i.test(line)) {
            authLoginSteps = 1;
            await say("334 UGFzc3dvcmQ6");
          } else {
            await say("235 Authenticated");
          }
        } else if (verb === "RCPT") {
          rcpt = line.match(/<([^>]*)>/)?.[1] ?? "";
          await say("250 OK");
        } else if (verb === "DATA") {
          inData = true;
          await say("354 End data with <CR><LF>.<CR><LF>");
        } else if (verb === "QUIT") {
          await say("221 Bye");
          break;
        } else {
          await say("250 OK");
        }
      }
    }
    conn.close();
  };
  serve();
  return {
    port: (listener.addr as Deno.NetAddr).port,
    mails,
    close: () => listener.close(),
  };
}

export function freePort(): number {
  const l = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (l.addr as Deno.NetAddr).port;
  l.close();
  return port;
}

export async function waitForHealth(
  base: string,
  server: Deno.ChildProcess,
): Promise<void> {
  let exited = false;
  server.status.then(() => exited = true);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error("the server exited before it became healthy");
    try {
      const res = await fetch(`${base}/health`);
      await res.body?.cancel();
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("the server did not answer /health within 30 s");
}
