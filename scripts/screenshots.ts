// Writes the README pictures under docs/screenshots/ (the booking-flow
// GIF and the confirmation email), plus docs/social-preview.png, from a
// local build of mig.
//
//   deno task build && deno task screenshots
//
// It starts the built app (`_fresh/server.js`) on a free port with
// placeholder configuration only ("Jane Doe", example.com addresses,
// Europe/Berlin), a throwaway data file and an in-process SMTP sink,
// so a booking succeeds and no mail leaves the machine. Chromium
// resolves meet.example.com (the placeholder PUBLIC_URL) to that local
// server and every other host name to nothing, so the pictures and
// the email show only placeholder addresses and the browser never
// reaches the network. PUBLIC_URL is plain http because the local
// server has no TLS; no picture shows it. Playwright's request routing
// can't stand in for the host mapping: it doesn't see the request a
// fulfilled redirect leads to, and the booking form's POST ends in one.
//
// Playwright is a dev-only tool outside the dependency budget in
// AGENTS.md, so it is not in deno.json's imports. The task runs this
// script with `--node-modules-dir=none --no-lock`: the pinned package
// comes from Deno's global cache, and neither node_modules nor
// deno.lock changes. The specifier is imported through a variable,
// not a string literal, because `deno check` (part of `deno task
// check`) resolves literal imports against the manual node_modules
// directory, where Playwright is not installed; the small interfaces
// below stand in for Playwright's own types.

const PLAYWRIGHT = "npm:playwright@1.63.0";

const ROOT = new URL("../", import.meta.url);
const SHOTS = new URL("docs/screenshots/", ROOT);
const SOCIAL = new URL("docs/social-preview.png", ROOT);
const PUBLIC_URL = "http://meet.example.com";
const VIEWPORT = { width: 1280, height: 800 };
const GUEST = {
  name: "John Doe",
  email: "john@example.com",
  notes: "A quick intro call about the new website.",
};
/** PNGs above this size get quantised to 256 colours, if ImageMagick is installed. */
const PNG_BUDGET = 400 * 1024;
/** Where the demo's drawn pointer rests before its first move. */
const POINTER_START = { x: 900, y: 620 };
/** Milliseconds between keystrokes in the demo: a calm human pace. */
const TYPING_DELAY = 70;

// ─── Minimal Playwright types (see the header for why) ──────────────

interface Locator {
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  pressSequentially(value: string, opts?: { delay?: number }): Promise<void>;
  first(): Locator;
  boundingBox(): Promise<
    { x: number; y: number; width: number; height: number } | null
  >;
  nth(index: number): Locator;
  count(): Promise<number>;
  getAttribute(name: string): Promise<string | null>;
  waitFor(opts?: { state?: string; timeout?: number }): Promise<void>;
  filter(opts: { hasText?: string | RegExp }): Locator;
  locator(selector: string): Locator;
}

interface Page {
  goto(url: string, opts?: { waitUntil?: string }): Promise<unknown>;
  setContent(html: string, opts?: { waitUntil?: string }): Promise<void>;
  locator(selector: string): Locator;
  frameLocator(selector: string): { locator(selector: string): Locator };
  screenshot(
    opts: {
      path: string;
      animations?: string;
      caret?: string;
      clip?: { x: number; y: number; width: number; height: number };
    },
  ): Promise<unknown>;
  waitForURL(url: RegExp, opts?: { timeout?: number }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  waitForFunction(fn: string): Promise<unknown>;
  evaluate(fn: string): Promise<unknown>;
  url(): string;
  mouse: {
    move(x: number, y: number, opts?: { steps?: number }): Promise<void>;
    down(): Promise<void>;
    up(): Promise<void>;
  };
  keyboard: { type(text: string, opts?: { delay?: number }): Promise<void> };
  video(): { path(): Promise<string> } | null;
}

interface ContextOptions {
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  timezoneId: string;
  locale: string;
  colorScheme: "light" | "dark";
  recordVideo?: { dir: string; size: { width: number; height: number } };
}

interface BrowserContext {
  newPage(): Promise<Page>;
  addInitScript(script: string): Promise<void>;
  close(): Promise<void>;
}

interface Browser {
  newContext(opts: ContextOptions): Promise<BrowserContext>;
  close(): Promise<void>;
}

interface Playwright {
  chromium: { launch(opts: { args: string[] }): Promise<Browser> };
}

// ─── Local SMTP sink ────────────────────────────────────────────────

interface CapturedMail {
  to: string;
  raw: string;
}

/** Accepts every message on 127.0.0.1 and keeps it in memory. Speaks
 *  just enough SMTP for nodemailer: EHLO, AUTH (any credentials),
 *  MAIL, RCPT, DATA, RSET, NOOP, QUIT. No STARTTLS is offered, so
 *  nodemailer stays on plain TCP to localhost. */
function startSmtpSink(): {
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
    await say("220 localhost mig screenshot sink");
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

/** The text/html part of a nodemailer message, decoded. */
function htmlPart(raw: string): string {
  const start = raw.search(/Content-Type: text\/html/i);
  if (start === -1) throw new Error("the captured email has no text/html part");
  const part = raw.slice(start);
  const headerEnd = part.indexOf(`\r\n\r\n`);
  const headers = part.slice(0, headerEnd);
  const body = part.slice(headerEnd + 4).split(/\r\n--/)[0];
  const encoding = headers.match(/Content-Transfer-Encoding:\s*(\S+)/i)?.[1]
    .toLowerCase();
  const bytes = encoding === "base64"
    ? Uint8Array.from(atob(body.replace(/\s+/g, "")), (c) => c.charCodeAt(0))
    : encoding === "quoted-printable"
    ? decodeQuotedPrintable(body)
    : new TextEncoder().encode(body);
  return new TextDecoder().decode(bytes);
}

function decodeQuotedPrintable(body: string): Uint8Array {
  const soft = body.replace(/=\r\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < soft.length; i++) {
    if (soft[i] === "=" && /^[0-9A-F]{2}$/i.test(soft.slice(i + 1, i + 3))) {
      out.push(parseInt(soft.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(...new TextEncoder().encode(soft[i]));
    }
  }
  return new Uint8Array(out);
}

// ─── Helpers ────────────────────────────────────────────────────────

function freePort(): number {
  const l = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (l.addr as Deno.NetAddr).port;
  l.close();
  return port;
}

async function latestVersion(): Promise<string> {
  try {
    const out = await new Deno.Command("git", {
      args: ["describe", "--tags", "--abbrev=0"],
      cwd: ROOT,
      stderr: "null",
    }).output();
    const tag = new TextDecoder().decode(out.stdout).trim();
    if (out.success && /^v\d/.test(tag)) return tag.slice(1);
  } catch {
    // git missing: fall through to the default below.
  }
  return "0.5.0";
}

async function hasCommand(name: string): Promise<boolean> {
  try {
    const out = await new Deno.Command(name, {
      args: ["-version"],
      stdout: "null",
      stderr: "null",
    })
      .output();
    return out.success;
  } catch {
    return false;
  }
}

async function run(cmd: string, args: string[]): Promise<void> {
  const out = await new Deno.Command(cmd, {
    args,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!out.success) {
    throw new Error(
      `${cmd} failed: ${new TextDecoder().decode(out.stderr).slice(-2000)}`,
    );
  }
}

async function waitForHealth(
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

/** Colours of the mail-client frame: Tailwind's slate scale, matching the
 *  email body's own #0f172a background, so frame and email read as one
 *  dark mail client. */
const MAIL_FRAME = {
  page: "#020617",
  pane: "#0f172a",
  bar: "#0b1120",
  line: "#1e293b",
  ink: "#e2e8f0",
  muted: "#94a3b8",
  accent: "#f97316",
};

/** One toolbar icon: a 20px stroked SVG path, the way mail clients draw them. */
function toolIcon(d: string): string {
  return `<span class="tool"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg></span>`;
}

/** A dark mail-client frame around the real email HTML: a toolbar, the
 *  subject, the sender with an avatar, the recipient and the attachment,
 *  then the email itself in an iframe sized to its content. The recipe is
 *  written down in .claude/skills/email-screenshot-frame/SKILL.md. */
function emailPage(
  mail: { from: string; to: string; subject: string; html: string },
): string {
  const esc = (s: string) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll(`"`, "&quot;");
  const from = mail.from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const fromName = from?.[1] || mail.from;
  const fromAddress = from?.[2] ?? "";
  const c = MAIL_FRAME;
  const icons = {
    back: "M15 18l-6-6 6-6",
    archive: "M3 7h18v4H3zM5 11v8h14v-8M10 15h4",
    trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
    unread: "M3 6h18v12H3zM3 6l9 7 9-7",
    reply: "M9 14l-5-5 5-5M4 9h10a6 6 0 0 1 6 6v3",
    forward: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0-6 6v3",
    more: "M5 12h.01M12 12h.01M19 12h.01",
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><title>Email</title>
<style>
  body { margin: 0; background: ${c.page}; font: 14px/1.5 system-ui, sans-serif; color: ${c.ink}; }
  .card { width: 760px; margin: 40px auto; background: ${c.pane}; border: 1px solid ${c.line}; border-radius: 12px; overflow: hidden; }
  .toolbar { display: flex; align-items: center; gap: 4px; padding: 8px 16px; background: ${c.bar}; border-bottom: 1px solid ${c.line}; color: ${c.muted}; }
  .tool { display: inline-flex; padding: 6px; border-radius: 6px; }
  .gap { flex: 1; }
  .sep { width: 1px; height: 20px; background: ${c.line}; margin: 0 6px; }
  .head { padding: 20px 28px; border-bottom: 1px solid ${c.line}; }
  .subject { font-size: 20px; font-weight: 600; margin-bottom: 16px; }
  .sender { display: flex; align-items: center; gap: 12px; }
  .avatar { width: 40px; height: 40px; border-radius: 50%; background: ${c.accent}; color: ${c.page}; font-weight: 700; font-size: 17px; display: flex; align-items: center; justify-content: center; }
  .name { font-weight: 600; }
  .addr, .meta { color: ${c.muted}; }
  .chip { display: inline-flex; align-items: center; gap: 8px; margin-top: 14px; padding: 6px 12px; border: 1px solid ${c.line}; border-radius: 8px; color: ${c.ink}; }
  .chip small { color: ${c.muted}; font-size: 12px; }
  iframe { width: 100%; border: 0; display: block; }
</style></head>
<body><div class="card">
  <div class="toolbar">
    ${toolIcon(icons.back)}<span class="sep"></span>${toolIcon(icons.archive)}${
    toolIcon(icons.trash)
  }${toolIcon(icons.unread)}
    <span class="gap"></span>
    ${toolIcon(icons.reply)}${toolIcon(icons.forward)}${toolIcon(icons.more)}
  </div>
  <div class="head">
    <div class="subject">${esc(mail.subject)}</div>
    <div class="sender">
      <div class="avatar">${esc(fromName.trim().charAt(0).toUpperCase())}</div>
      <div>
        <div><span class="name">${
    esc(fromName)
  }</span> <span class="addr">&lt;${esc(fromAddress)}&gt;</span></div>
        <div class="meta">to ${esc(mail.to)}</div>
      </div>
    </div>
    <div class="chip">${
    toolIcon("M8 3h6l4 4v14H8zM14 3v4h4")
  }<span>meeting.ics</span><small>Calendar invite</small></div>
  </div>
  <iframe id="body" srcdoc="${esc(mail.html)}"></iframe>
</div>
<script>
  const f = document.getElementById("body")
  f.addEventListener("load", () => {
    f.style.height = f.contentDocument.documentElement.scrollHeight + "px"
    document.body.dataset.ready = "1"
  })
</script>
</body></html>`;
}

function header(raw: string, name: string): string {
  const m = raw.match(new RegExp(`^${name}: (.*(?:\\r\\n[ \\t].*)*)`, "im"));
  return (m?.[1] ?? "").replace(/\r\n[ \t]+/g, " ").trim();
}

/** Screenshot with no hover, focus ring, caret or running animation.
 *  Refuses to write a picture taken in any zone but Europe/Berlin, so a
 *  dropped `timezoneId` can never leak the machine's own zone. `clip`
 *  crops to a region, for a page shorter than the viewport. `file` is
 *  usually under docs/screenshots/; the social preview's hero goes to
 *  the throwaway directory instead, since the README no longer shows it. */
async function shot(
  page: Page,
  file: URL,
  clip?: { x: number; y: number; width: number; height: number },
): Promise<void> {
  const zone = await page.evaluate(
    "Intl.DateTimeFormat().resolvedOptions().timeZone",
  );
  if (zone !== "Europe/Berlin") {
    throw new Error(
      `${file.pathname}: the browser runs in ${zone}, not Europe/Berlin`,
    );
  }
  await page.evaluate("document.activeElement?.blur?.()");
  await page.mouse.move(2, VIEWPORT.height - 2);
  await page.waitForTimeout(300);
  await page.screenshot({
    path: file.pathname,
    animations: "disabled",
    caret: "hide",
    clip,
  });
  if (file.href.startsWith(ROOT.href)) {
    console.log(`wrote ${file.href.slice(ROOT.href.length)}`);
  }
}

// ─── Demo pointer ───────────────────────────────────────────────────

/** A page script that draws a mouse pointer the recording can show:
 *  headless Chromium records no system cursor. It follows real mouse
 *  events, shows a ripple on each press, and keeps its position in
 *  sessionStorage, so it reappears in the same place after a page load
 *  (the context runs it again, via addInitScript, on every document). */
function pointerScript(start: { x: number; y: number }): string {
  return `(() => {
  if (window !== window.top) return
  const KEY = "__migDemoPointer"
  let pos = { x: ${start.x}, y: ${start.y} }
  try { pos = JSON.parse(sessionStorage.getItem(KEY)) ?? pos } catch {}
  const el = document.createElement("div")
  el.setAttribute("aria-hidden", "true")
  el.style.cssText = "position:fixed;left:0;top:0;width:24px;height:28px;pointer-events:none;" +
    "z-index:2147483647;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))"
  el.innerHTML = '<svg width="24" height="28" viewBox="0 0 24 28" style="display:block;' +
    'transform-origin:3px 2px;transition:transform 90ms ease-out">' +
    '<path d="M3 2 L3 21.5 L8.3 16.4 L11.9 24.6 L15.3 23.1 L11.8 15.1 L19 14.8 Z" ' +
    'fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  const place = () => { el.style.transform = "translate(" + (pos.x - 3) + "px," + (pos.y - 2) + "px)" }
  place()
  const mount = () => { if (!el.isConnected) (document.body ?? document.documentElement)?.appendChild(el) }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount)
  mount()
  addEventListener("mousemove", (e) => {
    pos = { x: e.clientX, y: e.clientY }
    place()
    mount()
    try { sessionStorage.setItem(KEY, JSON.stringify(pos)) } catch {}
  }, true)
  // The click mark: an opaque accent ring and a solid dot, about 88 px
  // across at the end, so they keep their colour in a 256-colour GIF.
  // Gone within 400 ms, and removed at once if the page starts to
  // unload, so a slow navigation never freezes it on screen.
  const ripples = new Set()
  const clear = () => { for (const r of ripples) r.remove(); ripples.clear() }
  addEventListener("beforeunload", clear, true)
  addEventListener("pagehide", clear, true)
  addEventListener("mousedown", (e) => {
    el.firstChild.style.transform = "scale(.7)"
    const r = document.createElement("div")
    r.style.cssText = "position:fixed;width:88px;height:88px;margin:-44px 0 0 -44px;border-radius:50%;" +
      "box-sizing:border-box;pointer-events:none;z-index:2147483646;left:" + e.clientX + "px;top:" +
      e.clientY + "px;border:5px solid #38bdf8;" +
      "background:radial-gradient(circle,#38bdf8 0 14px,transparent 15px)"
    document.documentElement.appendChild(r)
    ripples.add(r)
    r.animate([
      { transform: "scale(.25)", opacity: 1 },
      { transform: "scale(.8)", opacity: 1, offset: 0.5 },
      { transform: "scale(1)", opacity: 0 },
    ], { duration: 400, easing: "ease-out", fill: "forwards" }).onfinish = () => {
      r.remove()
      ripples.delete(r)
    }
  }, true)
  addEventListener("mouseup", () => { el.firstChild.style.transform = "" }, true)
})()`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Moves the real mouse (and so the drawn pointer) to `to` along a
 *  gently curved, ease-in-out path, one small step about every 12 ms,
 *  over 400–700 ms depending on the distance. Wall-clock timed, so the
 *  recording shows the same pace whatever the machine's speed. */
async function moveLike(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const duration = Math.min(700, Math.max(400, dist * 0.8));
  // A slight arc, perpendicular to the straight line, reads as a hand.
  const bow = Math.min(40, dist * 0.08);
  const nx = dist ? -dy / dist : 0;
  const ny = dist ? dx / dist : 0;
  const ease = (t: number) => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
  const t0 = Date.now();
  while (true) {
    const t = Math.min(1, (Date.now() - t0) / duration);
    const e = ease(t);
    const arc = Math.sin(Math.PI * t) * bow;
    await page.mouse.move(
      from.x + dx * e + nx * arc,
      from.y + dy * e + ny * arc,
    );
    if (t === 1) break;
    await sleep(12);
  }
  from.x = to.x;
  from.y = to.y;
}

/** Scrolls `target` into the middle of the viewport if it is near an
 *  edge, glides the pointer to its centre and presses it like a person:
 *  a short pause, press, release. `pointer` is updated in place. */
async function clickLike(
  page: Page,
  pointer: { x: number; y: number },
  target: Locator,
): Promise<void> {
  await target.waitFor();
  let box = await target.boundingBox();
  if (!box) throw new Error("the demo's click target has no box");
  if (box.y < 96 || box.y + box.height > VIEWPORT.height - 48) {
    const delta = Math.round(box.y + box.height / 2 - VIEWPORT.height / 2);
    await page.evaluate(`scrollBy({ top: ${delta}, behavior: "smooth" })`);
    await page.waitForTimeout(800);
    box = await target.boundingBox();
    if (!box) throw new Error("the demo's click target has no box");
  }
  await moveLike(page, pointer, {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  });
  await page.waitForTimeout(150);
  await page.mouse.down();
  // Held long enough for the click mark to reach full size before the
  // release, which is what starts a navigation and clears the mark.
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/** ffmpeg arguments for the README GIF: drop the first `trimStart`
 *  seconds (the blank page before the first paint), resample the
 *  variable-rate WebM to a steady 20 fps, and build one palette for the
 *  whole clip from the pixels that change (stats_mode=diff), then apply
 *  it with a light ordered dither, which keeps flat dark areas still
 *  from frame to frame. */
function gifArgs(
  webm: string,
  trimStart: number,
  gif: string,
): string[] {
  return [
    "-y",
    "-i",
    webm,
    "-ss",
    trimStart.toFixed(2),
    "-vf",
    "fps=20,scale=800:-1:flags=lanczos,split[a][b];" +
    "[a]palettegen=max_colors=256:stats_mode=diff[p];" +
    "[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
    "-loop",
    "0",
    gif,
  ];
}

async function fitPng(path: string, magick: boolean): Promise<void> {
  if ((await Deno.stat(path)).size <= PNG_BUDGET || !magick) return;
  await run("magick", [path, "-colors", "256", `PNG8:${path}`]);
}

// ─── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const serverEntry = new URL("_fresh/server.js", ROOT);
  try {
    await Deno.stat(serverEntry);
  } catch {
    throw new Error(
      `_fresh/server.js is missing: run \`deno task build\` first`,
    );
  }

  const { chromium } = (await import(PLAYWRIGHT)) as Playwright;
  const tmp = await Deno.makeTempDir({ prefix: "mig-screenshots-" });
  const smtp = startSmtpSink();
  const port = freePort();
  const local = `http://127.0.0.1:${port}`;

  const cancelSecret = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
  );
  let server: Deno.ChildProcess | null = null;
  let browser: Browser | null = null;
  try {
    server = new Deno.Command(Deno.execPath(), {
      args: [
        "serve",
        "-A",
        "--unstable-temporal",
        `--port=${port}`,
        "_fresh/server.js",
      ],
      cwd: ROOT,
      clearEnv: true,
      env: {
        PATH: Deno.env.get("PATH") ?? "",
        HOME: Deno.env.get("HOME") ?? tmp,
        ...(Deno.env.get("DENO_DIR")
          ? { DENO_DIR: Deno.env.get("DENO_DIR")! }
          : {}),
        HOST_NAME: "Jane Doe",
        HOST_EMAIL: "jane@example.com",
        HOST_TZ: "Europe/Berlin",
        MEETING_URL: "https://video.example.com/jane-doe",
        WEEKLY_AVAILABILITY: "MON-FRI 09:00-17:00",
        SLOT_DURATION_MIN: "30",
        MIN_NOTICE_HOURS: "6",
        BOOKING_HORIZON_DAYS: "21",
        CANCEL_SECRET: cancelSecret,
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: String(smtp.port),
        SMTP_USER: "jane@example.com",
        SMTP_PASSWORD: "placeholder",
        SMTP_FROM: "Bookings <book@example.com>",
        PUBLIC_URL,
        PORT: String(port),
        DATA_PATH: `${tmp}/bookings.json`,
        RATE_LIMIT_PER_5MIN: "100",
        MIG_VERSION: await latestVersion(),
      },
      stdout: "null",
      stderr: "null",
    }).spawn();
    await waitForHealth(local, server);

    await Deno.mkdir(SHOTS, { recursive: true });
    browser = await chromium.launch({
      args: [
        `--host-resolver-rules=MAP meet.example.com 127.0.0.1:${port}, MAP * ~NOTFOUND`,
        // Chromium would otherwise try https:// first for the placeholder
        // host, and refuse to frame it from the placeholder parent page
        // because it resolves to a loopback address.
        "--disable-features=HttpsUpgrades,LocalNetworkAccessChecks",
      ],
    });
    const contextFor = async (colorScheme: "light" | "dark", extra = {}) => {
      const ctx = await browser!.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 2,
        timezoneId: "Europe/Berlin",
        locale: "en-US",
        colorScheme,
        ...extra,
      });
      return ctx;
    };

    // The first bookable date with a full day of slots, read from the picker.
    const probe = await contextFor("light");
    const probePage = await probe.newPage();
    await probePage.goto(`${PUBLIC_URL}/`, { waitUntil: "networkidle" });
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
    }).format(new Date());
    const days = probePage.locator(`[aria-label$=" 16 slots available"]`);
    const dates: string[] = [];
    for (let i = 0; i < (await days.count()); i++) {
      dates.push(
        (await days.nth(i).getAttribute("aria-label"))?.split(" ")[0] ?? "",
      );
    }
    // A later weekday, not today, so no slot has passed while the script runs.
    const date = dates.find((d) => d > today);
    if (!date) {
      throw new Error("the picker shows no fully bookable weekday after today");
    }
    await probe.close();

    const slotsVisible = (page: Page) =>
      page.locator(`section[aria-labelledby="step-time"] :is(button, a)`)
        .first().waitFor();

    // The social preview's hero: the light booking page with the picked
    // date's slots. It lands in the throwaway directory, not the README.
    const heroFile = new URL("hero.png", `file://${tmp}/`);
    const heroCtx = await contextFor("light");
    const heroPage = await heroCtx.newPage();
    await heroPage.goto(`${PUBLIC_URL}/?date=${date}`, {
      waitUntil: "networkidle",
    });
    await slotsVisible(heroPage);
    await shot(heroPage, heroFile);
    await heroCtx.close();

    // One real booking through the form, so the SMTP sink gets the email.
    const bookCtx = await contextFor("light");
    const bookPage = await bookCtx.newPage();
    await bookPage.goto(`${PUBLIC_URL}/?date=${date}&slot=11:00`, {
      waitUntil: "networkidle",
    });
    await bookPage.locator(`input[name="name"]`).fill(GUEST.name);
    await bookPage.locator(`input[name="email"]`).fill(GUEST.email);
    await bookPage.locator(`textarea[name="notes"]`).fill(GUEST.notes);
    await bookPage.locator(
      `form[aria-label="Booking details"] button[type="submit"]`,
    ).click();
    await bookPage.waitForURL(/\/confirmed\?/, { timeout: 30_000 });
    await bookCtx.close();

    // The guest's confirmation email, exactly as lib/email.ts produced it,
    // in a dark mail-client frame to match the email's dark body.
    const guestMail = smtp.mails.find((m) => m.to === GUEST.email);
    if (!guestMail) {
      throw new Error("the SMTP sink received no email for the guest");
    }
    const mailCtx = await contextFor("dark");
    const mailPage = await mailCtx.newPage();
    await mailPage.setContent(
      emailPage({
        from: header(guestMail.raw, "From"),
        to: `${GUEST.name} <${GUEST.email}>`,
        subject: header(guestMail.raw, "Subject"),
        html: htmlPart(guestMail.raw),
      }),
      { waitUntil: "load" },
    );
    await mailPage.waitForFunction(`document.body.dataset.ready === "1"`);
    // The email is shorter than the viewport: crop 40px below the card.
    const cardBottom = Number(
      await mailPage.evaluate(
        `document.querySelector(".card").getBoundingClientRect().bottom`,
      ),
    );
    await shot(mailPage, new URL("email-confirmation.png", SHOTS), {
      x: 0,
      y: 0,
      width: VIEWPORT.width,
      height: Math.min(VIEWPORT.height, Math.ceil(cardBottom) + 40),
    });
    await mailCtx.close();

    // The main flow as a short clip, dark theme: date → time → confirm →
    // confirmed. A drawn pointer (see pointerScript) moves along eased
    // paths and shows each click, so a viewer can follow what happens.
    const videoDir = `${tmp}/video`;
    const videoCtx = await contextFor("dark", {
      deviceScaleFactor: 1,
      recordVideo: { dir: videoDir, size: VIEWPORT },
    });
    await videoCtx.addInitScript(pointerScript(POINTER_START));
    const videoPage = await videoCtx.newPage();
    // The recording starts with the page; everything before the first
    // painted booking page is cut off by `trimStart` below.
    const recordStart = Date.now();
    await videoPage.goto(`${PUBLIC_URL}/`, { waitUntil: "networkidle" });
    await videoPage.mouse.move(POINTER_START.x, POINTER_START.y);
    await videoPage.waitForTimeout(300);
    const trimStart = (Date.now() - recordStart) / 1000;
    const pointer = { ...POINTER_START };
    await videoPage.waitForTimeout(900);
    await clickLike(
      videoPage,
      pointer,
      videoPage.locator(`[aria-label^="${date} "]`),
    );
    await slotsVisible(videoPage);
    await videoPage.waitForTimeout(900);
    await clickLike(
      videoPage,
      pointer,
      videoPage.locator(`section[aria-labelledby="step-time"] :is(button, a)`)
        .filter({ hasText: /^\s*15:30\s*$/ }).first(),
    );
    await videoPage.locator(`input[name="name"]`).waitFor();
    await videoPage.waitForTimeout(800);
    await clickLike(
      videoPage,
      pointer,
      videoPage.locator(`input[name="name"]`),
    );
    await videoPage.keyboard.type(GUEST.name, { delay: TYPING_DELAY });
    await videoPage.waitForTimeout(300);
    await clickLike(
      videoPage,
      pointer,
      videoPage.locator(`input[name="email"]`),
    );
    await videoPage.keyboard.type(GUEST.email, { delay: TYPING_DELAY });
    await videoPage.waitForTimeout(700);
    await clickLike(
      videoPage,
      pointer,
      videoPage.locator(
        `form[aria-label="Booking details"] button[type="submit"]`,
      ),
    );
    await videoPage.waitForURL(/\/confirmed\?/, { timeout: 30_000 });
    await videoPage.waitForTimeout(600);
    await moveLike(videoPage, pointer, { x: 1100, y: 700 });
    await videoPage.waitForTimeout(2400);
    const video = videoPage.video();
    await videoCtx.close();
    const webm = await video?.path();
    if (!webm) throw new Error("Playwright recorded no video");
    if (await hasCommand("ffmpeg")) {
      const gif = new URL("booking-flow.gif", SHOTS).pathname;
      await run("ffmpeg", gifArgs(webm, trimStart, gif));
      console.log("wrote docs/screenshots/booking-flow.gif");
    } else {
      await Deno.copyFile(webm, new URL("booking-flow.webm", SHOTS));
      console.log(
        "ffmpeg not found: wrote docs/screenshots/booking-flow.webm instead of a GIF",
      );
    }

    // The social preview: the product on a neutral background, name and one line.
    const hero = await Deno.readFile(heroFile);
    const heroSrc = `data:image/png;base64,${
      btoa(Array.from(hero, (b) => String.fromCharCode(b)).join(``))
    }`;
    const socialCtx = await browser.newContext({
      viewport: { width: 1280, height: 640 },
      deviceScaleFactor: 1,
      timezoneId: "Europe/Berlin",
      locale: "en-US",
      colorScheme: "light",
    });
    const socialPage = await socialCtx.newPage();
    await socialPage.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>
        body { margin: 0; width: 1280px; height: 640px; overflow: hidden; background: #eef0f3;
          font-family: system-ui, sans-serif; color: #18181b; position: relative; }
        .text { position: absolute; left: 72px; top: 0; bottom: 0; width: 420px;
          display: flex; flex-direction: column; justify-content: center; }
        .name { font-size: 112px; font-weight: 800; letter-spacing: -4px; line-height: 1; }
        .line { font-size: 30px; line-height: 1.3; color: #3f3f46; margin-top: 24px; }
        .url { font-size: 20px; color: #71717a; margin-top: 32px; }
        img { position: absolute; left: 540px; top: 72px; width: 880px; border-radius: 14px;
          box-shadow: 0 24px 60px rgba(24, 24, 27, .18), 0 0 0 1px rgba(24, 24, 27, .08); }
      </style></head><body>
        <div class="text">
          <div class="name">mig</div>
          <div class="line">A tiny self-hosted meeting scheduler.</div>
          <div class="url">One owner · one URL · no database</div>
        </div>
        <img src="${heroSrc}" alt="">
      </body></html>`,
      { waitUntil: "load" },
    );
    await socialPage.screenshot({
      path: SOCIAL.pathname,
      animations: "disabled",
      caret: "hide",
    });
    await socialCtx.close();
    console.log("wrote docs/social-preview.png");

    const magick = await hasCommand("magick");
    if (!magick) {
      console.log("ImageMagick not found: PNGs are left uncompressed");
    }
    for await (const entry of Deno.readDir(SHOTS)) {
      if (entry.name.endsWith(".png")) {
        await fitPng(new URL(entry.name, SHOTS).pathname, magick);
      }
    }
    await fitPng(SOCIAL.pathname, magick);
  } finally {
    await browser?.close().catch(() => {});
    if (server) {
      try {
        server.kill("SIGTERM");
      } catch {
        // Already exited.
      }
      await server.status;
    }
    smtp.close();
    await Deno.remove(tmp, { recursive: true });
  }
}

await main();
