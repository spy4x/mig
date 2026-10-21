// Records mig's demo video (issue #134): a guest books a meeting, lands on
// "You're booked", and the confirmation email opens in a local Mailpit. Writes
// the raw take to media/demo/take/ (gitignored), the captions to
// media/demo/captions.vtt, then runs encode.ts, which writes the videos and
// posters. Steps and requirements: README.md beside this file.
//
//   deno task demo-video
//
// Staged data only: the built app runs with placeholder settings (Jane Doe,
// example.com addresses, Europe/Berlin) and a throwaway data file, and mails
// a throwaway Mailpit container. Chromium maps meet.example.com to mig,
// mail.example.com to Mailpit and every other host to nothing, so nothing on
// screen is real and nothing leaves the machine. The container, mig and the
// browser are stopped on success and on failure.
//
// How it records: Chrome's screencast sends a 2560×1600 frame each time the
// page paints, each stamped with when it arrived, so a busy machine delays a
// frame instead of dropping time. The captions are timed here, while the
// steps run, and written as WebVTT; the encoder burns them in.

import { freePort, waitForHealth } from "../../../scripts/local-app.ts"
import {
  BAND,
  type Browser,
  type BrowserContext,
  CAPTIONS,
  type CDPSession,
  type Cue,
  cueSeconds,
  type Frame,
  HOLD,
  launch,
  type Locator,
  must,
  type Page,
  ROOT,
  type Segment,
  SIZE,
  TAKE,
  type Take,
  toVtt,
} from "./shared.ts"
import { encode } from "./encode.ts"

/** Pinned by version and digest, so a new release cannot change the video unnoticed. */
const MAILPIT_IMAGE =
  "axllent/mailpit:v1.31.3@sha256:ed9b00c609e77e99c79b93f1178255ebc271868920f2c69a8d166bd5634ed10d"
const MEET = "http://meet.example.com"
const MAIL = "http://mail.example.com"
const GUEST = { name: "John Doe", email: "john@example.com" }
const SLOT = "15:30"
/** One half of the closing split frame; the encoder puts an 8 px gap between the halves. */
const HALF = { width: 636, height: 800 }
/** Where the pointer rests before its first move. */
const POINTER_START = { x: 980, y: 600 }
/** Milliseconds between keystrokes: a calm human pace. */
const TYPING_DELAY = 90
/** A click target nearer the bottom than this is scrolled up, clear of the caption band. */
const BOTTOM_LIMIT = SIZE.height - BAND - 48

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const now = () => Date.now() / 1000

/** Polls `check` every 300 ms until it returns true or the deadline passes. */
async function waitUntil(
  label: string,
  timeoutMs: number,
  check: () => Promise<boolean>,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return
    await sleep(300)
  }
  throw new Error(`${label} not ready after ${timeoutMs / 1000}s`)
}

/** The checkout's latest release tag without the "v", for mig's footer. */
async function migVersion(): Promise<string> {
  const tag =
    (await must("git", ["-C", ROOT, "describe", "--tags", "--abbrev=0"]).catch(
      () => "",
    ))
      .trim()
  return /^v\d/.test(tag) ? tag.slice(1) : "0.0.0"
}

/**
 * The take's clock: shots back to back after the title card, and the captions
 * timed against it. `say` keeps the previous caption up until it has been
 * readable for long enough, which is also what paces the steps.
 */
class Timeline {
  readonly segments: Segment[] = []
  readonly cues: Cue[] = []
  private done = 0
  private shotStart = 0
  private frames: Frame[] | null = null

  /** Seconds from the start of the final video. */
  at(): number {
    return HOLD.title + this.done + (this.frames ? now() - this.shotStart : 0)
  }

  begin(first: Frame) {
    this.shotStart = first.at
    this.frames = [first]
  }

  push(frame: Frame) {
    this.frames?.push(frame)
  }

  /** Waits until the caption on screen has been readable long enough. */
  async hold() {
    const open = this.cues.at(-1)
    if (!open || open.end > 0) return
    const wait = open.start + cueSeconds(open.text) - this.at()
    if (wait > 0) await sleep(wait * 1000)
  }

  async say(text: string, top = false) {
    await this.hold()
    const open = this.cues.at(-1)
    if (open && open.end === 0) open.end = this.at()
    this.cues.push({ start: this.at(), end: 0, text, ...(top ? { top } : {}) })
  }

  /** Ends the shot, after the caption on screen has had its time. */
  async end() {
    await this.hold()
    if (!this.frames) throw new Error("no shot is running")
    const end = now()
    const open = this.cues.at(-1)
    if (open && open.end === 0) open.end = this.at()
    this.segments.push({ frames: this.frames, end })
    this.done += end - this.shotStart
    this.frames = null
  }
}

/** Collects one page's screencast frames into the timeline while a shot runs. */
class Recorder {
  private latest: string | null = null
  private count = 0
  private writes: Promise<void>[] = []

  constructor(
    private readonly cdp: CDPSession,
    private readonly timeline: Timeline,
    private readonly prefix: string,
  ) {}

  async start() {
    this.cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
      // Acknowledge first, so Chrome sends the next paint without waiting for the disk.
      this.cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {})
      this.latest = data
      this.timeline.push(this.write(data))
    })
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 90,
      maxWidth: SIZE.width * 2,
      maxHeight: SIZE.height * 2,
      everyNthFrame: 1,
    })
    await waitUntil(
      "the first screencast frame",
      10_000,
      () => Promise.resolve(!!this.latest),
    )
  }

  /** Starts a shot with what the screen shows now. */
  begin() {
    if (!this.latest) throw new Error("the screencast sent no frame yet")
    this.timeline.begin(this.write(this.latest))
  }

  async stop() {
    await this.cdp.send("Page.stopScreencast")
    await Promise.all(this.writes)
  }

  private write(data: string): Frame {
    const file = `${TAKE}frames/${this.prefix}-${
      String(this.count++).padStart(5, "0")
    }.jpg`
    this.writes.push(
      Deno.writeFile(file, Uint8Array.from(atob(data), (c) => c.charCodeAt(0))),
    )
    return { file, at: now() }
  }
}

/** A page script that draws a mouse pointer the recording can show: headless
 *  Chromium records no system cursor. It follows real mouse events, shows a
 *  ring on each press, and keeps its position in sessionStorage, so it
 *  reappears in the same place after a page load (the context runs it again
 *  on every document). */
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
  // The click mark: a ring and a dot, gone within 400 ms, and removed at
  // once if the page starts to unload, so a navigation never freezes it.
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
})()`
}

/** An init script: iframes stay transparent until a non-blank document has
 *  loaded, so Mailpit's preview never flashes white. */
const HIDE_BLANK_IFRAMES = `(() => {
  if (globalThis !== globalThis.top) return
  const style = document.createElement("style")
  style.textContent = "iframe:not([data-demo-ready]) { opacity: 0 !important }"
  const mount = () => (document.head ?? document.documentElement)?.appendChild(style)
  if (!mount()) document.addEventListener("DOMContentLoaded", mount)
  document.addEventListener("load", (e) => {
    const f = e.target
    if (!(f instanceof HTMLIFrameElement)) return
    let blank = false
    try { blank = f.contentWindow.location.href === "about:blank" } catch { /* cross-origin */ }
    if (!blank) f.dataset.demoReady = "1"
  }, true)
})()`

/** Moves the mouse (and so the drawn pointer) to `to` along a gently curved,
 *  ease-in-out path over 400–700 ms, wall-clock timed. `from` is updated. */
async function moveLike(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.hypot(dx, dy)
  const duration = Math.min(700, Math.max(400, dist * 0.8))
  const bow = Math.min(40, dist * 0.08)
  const nx = dist ? -dy / dist : 0
  const ny = dist ? dx / dist : 0
  const ease = (t: number) => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
  const t0 = Date.now()
  while (true) {
    const t = Math.min(1, (Date.now() - t0) / duration)
    const arc = Math.sin(Math.PI * t) * bow
    await page.mouse.move(
      from.x + dx * ease(t) + nx * arc,
      from.y + dy * ease(t) + ny * arc,
    )
    if (t === 1) break
    await sleep(12)
  }
  from.x = to.x
  from.y = to.y
}

/** Scrolls `target` up if it is under the caption band, glides the pointer
 *  to its centre and presses it like a person. */
async function clickLike(
  page: Page,
  pointer: { x: number; y: number },
  target: Locator,
) {
  await target.waitFor()
  let box = await target.boundingBox()
  if (!box) throw new Error("the click target has no box")
  if (box.y < 96 || box.y + box.height > BOTTOM_LIMIT) {
    const delta = Math.round(box.y + box.height / 2 - (SIZE.height - BAND) / 2)
    await page.evaluate(`scrollBy({ top: ${delta}, behavior: "smooth" })`)
    await page.waitForTimeout(800)
    box = await target.boundingBox()
    if (!box) throw new Error("the click target has no box")
  }
  await moveLike(page, pointer, {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  })
  await page.waitForTimeout(150)
  await page.mouse.down()
  // Long enough for the click mark to show before a navigation clears it.
  await page.waitForTimeout(200)
  await page.mouse.up()
  await page.waitForTimeout(200)
}

async function typeLike(
  page: Page,
  pointer: { x: number; y: number },
  field: Locator,
  text: string,
) {
  await clickLike(page, pointer, field)
  await page.keyboard.type(text, { delay: TYPING_DELAY })
}

function contextFor(
  browser: Browser,
  viewport = SIZE,
): Promise<BrowserContext> {
  return browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    timezoneId: "Europe/Berlin",
    locale: "en-US",
    colorScheme: "dark",
  })
}

const slots = (page: Page) =>
  page.locator(`section[aria-labelledby="step-time"] :is(button, a)`)
const slotAt = (page: Page) =>
  slots(page).filter({ hasText: new RegExp(`^\\s*${SLOT}\\s*$`) }).first()

/** The first day in the picker whose 15:30 slot is still free. */
async function pickDate(browser: Browser): Promise<string> {
  const ctx = await contextFor(browser)
  try {
    const page = await ctx.newPage()
    await page.goto(`${MEET}/`, { waitUntil: "networkidle" })
    const days = page.locator(`[data-calendar-date]:not([disabled])`)
    const dates: string[] = []
    for (let i = 0; i < await days.count(); i++) {
      const d = await days.nth(i).getAttribute("data-calendar-date")
      if (d) dates.push(d)
    }
    for (const date of dates) {
      await page.goto(`${MEET}/?date=${date}`, { waitUntil: "networkidle" })
      if (
        await slots(page).filter({ hasText: new RegExp(`^\\s*${SLOT}\\s*$`) })
          .count()
      ) {
        return date
      }
    }
    throw new Error(`no day in the picker has a free ${SLOT} slot`)
  } finally {
    await ctx.close()
  }
}

/** A screenshot of `url` without the pointer, for a still. */
async function still(
  browser: Browser,
  url: string,
  file: string,
  viewport = SIZE,
) {
  const ctx = await contextFor(browser, viewport)
  try {
    const page = await ctx.newPage()
    await page.goto(url, { waitUntil: "networkidle" })
    await page.waitForTimeout(800)
    await page.screenshot({ path: file })
  } finally {
    await ctx.close()
  }
}

/** Part 1: the booking, from the month grid to "You're booked". Returns the confirmed URL. */
async function recordBooking(
  browser: Browser,
  timeline: Timeline,
  date: string,
): Promise<string> {
  const ctx = await contextFor(browser)
  try {
    await ctx.addInitScript(pointerScript(POINTER_START))
    const page = await ctx.newPage()
    await page.goto(`${MEET}/`, { waitUntil: "networkidle" })
    const pointer = { ...POINTER_START }
    await page.mouse.move(pointer.x, pointer.y)
    const rec = new Recorder(await ctx.newCDPSession(page), timeline, "book")
    await rec.start()
    await page.waitForTimeout(500)
    rec.begin()

    await timeline.say("Your guest opens your booking link")
    await page.waitForTimeout(1500)
    await timeline.say("They pick a free day")
    await clickLike(
      page,
      pointer,
      page.locator(`[data-calendar-date="${date}"]`),
    )
    await slotAt(page).waitFor()
    await page.waitForTimeout(1500)
    await timeline.say("Then a time, shown in their own time zone")
    await page.waitForTimeout(800)
    await clickLike(page, pointer, slotAt(page))
    await page.locator(`input[name="name"]`).waitFor()
    await page.waitForTimeout(1500)
    await timeline.say("They type a name and an email")
    await typeLike(
      page,
      pointer,
      page.locator(`input[name="name"]`),
      GUEST.name,
    )
    await page.waitForTimeout(500)
    await typeLike(
      page,
      pointer,
      page.locator(`input[name="email"]`),
      GUEST.email,
    )
    await page.waitForTimeout(1000)
    await timeline.say("One click books the meeting")
    await clickLike(
      page,
      pointer,
      page.locator(`form[aria-label="Booking details"] button[type="submit"]`),
    )
    await page.waitForURL(/\/confirmed\?/, { timeout: 30_000 })
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1200)
    await timeline.say("Booked, without signing up for anything")
    await moveLike(page, pointer, { x: 1180, y: 640 })
    await page.waitForTimeout(1800)
    await timeline.end()
    await rec.stop()
    return page.url()
  } finally {
    await ctx.close()
  }
}

/** Part 2: the inbox, then the guest's email and its calendar invite. */
async function recordMail(
  browser: Browser,
  timeline: Timeline,
  messageId: string,
) {
  const ctx = await contextFor(browser)
  try {
    await ctx.addInitScript(pointerScript(POINTER_START))
    await ctx.addInitScript(HIDE_BLANK_IFRAMES)
    const page = await ctx.newPage()
    await page.goto(`${MAIL}/`, { waitUntil: "networkidle" })
    const row = page.locator(`a[href$="/view/${messageId}"]`).first()
    await row.waitFor()
    const pointer = { ...POINTER_START }
    await page.mouse.move(pointer.x, pointer.y)
    const rec = new Recorder(await ctx.newCDPSession(page), timeline, "mail")
    await rec.start()
    await page.waitForTimeout(500)
    rec.begin()

    await timeline.say("You both get an email right away")
    await page.waitForTimeout(1800)
    await clickLike(page, pointer, row)
    await page.waitForURL(new RegExp(`/view/${messageId}`))
    await page.waitForLoadState("networkidle")
    // The email's preview frame stays hidden until it has loaded (HIDE_BLANK_IFRAMES).
    await page.locator("iframe[data-demo-ready]").first().waitFor({
      timeout: 30_000,
    })
    await page.waitForTimeout(600)
    await timeline.say("It has the time, the meeting link and a cancel link")
    await page.waitForTimeout(2500)
    // The invite is listed at the bottom, so this caption sits at the top.
    await timeline.say("A calendar invite comes attached", true)
    await clickLike(
      page,
      pointer,
      page.getByRole("button", { name: /Show attachment details/ }).filter({
        visible: true,
      }),
    )
    await page.getByText("meeting.ics").filter({ visible: true }).first()
      .waitFor()
    await page.waitForTimeout(300)
    // The message pane scrolls on its own: wheel over it in small steps.
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 25)
      await page.waitForTimeout(40)
    }
    await page.waitForTimeout(600)
    await moveLike(page, pointer, { x: 1180, y: 420 })
    await page.waitForTimeout(1800)
    await timeline.end()
    await rec.stop()
  } finally {
    await ctx.close()
  }
}

async function main() {
  await Deno.stat(`${ROOT}_fresh/server.js`).catch(() => {
    throw new Error("_fresh/server.js is missing: run `deno task build` first")
  })
  await Deno.remove(TAKE, { recursive: true }).catch(() => {})
  await Deno.mkdir(`${TAKE}frames`, { recursive: true })

  const container = `mig-demo-mailpit-${Deno.pid}`
  let containerStarted = false
  let server: Deno.ChildProcess | null = null
  let browser: Browser | null = null
  try {
    // Mailpit: SMTP for mig, and the inbox the video opens.
    await must("docker", [
      ...[
        "run",
        "-d",
        "--rm",
        "--name",
        container,
        "--pids-limit=500",
        "--memory=1g",
      ],
      ...["-p", "127.0.0.1::1025", "-p", "127.0.0.1::8025"],
      ...[
        "-e",
        "MP_SMTP_AUTH_ACCEPT_ANY=1",
        "-e",
        "MP_SMTP_AUTH_ALLOW_INSECURE=1",
      ],
      MAILPIT_IMAGE,
    ])
    containerStarted = true
    const hostPort = async (p: number) =>
      Number(
        (await must("docker", ["port", container, `${p}/tcp`])).trim().split(
          ":",
        ).pop(),
      )
    const smtpPort = await hostPort(1025)
    const uiPort = await hostPort(8025)
    const api = `http://127.0.0.1:${uiPort}/api/v1`
    await waitUntil(
      "Mailpit",
      30_000,
      async () => (await fetch(`${api}/info`)).ok,
    )

    const port = freePort()
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
        HOME: Deno.env.get("HOME") ?? TAKE,
        ...(Deno.env.get("DENO_DIR")
          ? { DENO_DIR: Deno.env.get("DENO_DIR")! }
          : {}),
        HOST_NAME: "Jane Doe",
        HOST_EMAIL: "jane@example.com",
        HOST_TZ: "Europe/Berlin",
        MEETING_URL: "https://video.example.com/jane-doe",
        WEEKLY_AVAILABILITY: "MON-FRI 09:00-17:00",
        SLOT_DURATION_MIN: "30",
        // Two hours, so a run in the morning can still show today's 15:30.
        MIN_NOTICE_HOURS: "2",
        BOOKING_HORIZON_DAYS: "21",
        CANCEL_SECRET: btoa(
          String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
        ),
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: String(smtpPort),
        SMTP_USER: "jane@example.com",
        SMTP_PASSWORD: "placeholder",
        SMTP_FROM: "Bookings <book@example.com>",
        // Mailpit offers no TLS (mig#98).
        SMTP_ALLOW_PLAINTEXT: "true",
        PUBLIC_URL: MEET,
        PORT: String(port),
        DATA_PATH: `${TAKE}bookings.json`,
        RATE_LIMIT_PER_5MIN: "100",
        MIG_VERSION: await migVersion(),
      },
      stdout: "null",
      stderr: "null",
    }).spawn()
    await waitForHealth(`http://127.0.0.1:${port}`, server)

    browser = await launch([
      `--host-resolver-rules=MAP meet.example.com 127.0.0.1:${port}, ` +
      `MAP mail.example.com 127.0.0.1:${uiPort}, MAP * ~NOTFOUND`,
      "--disable-features=HttpsUpgrades,LocalNetworkAccessChecks",
    ])
    const date = await pickDate(browser)
    console.log(`booking ${date} ${SLOT}`)
    const poster = `${TAKE}poster.png`
    await still(browser, `${MEET}/`, poster)

    const timeline = new Timeline()
    const confirmed = await recordBooking(browser, timeline, date)

    let messageId = ""
    await waitUntil("the guest's email", 30_000, async () => {
      const list = await (await fetch(`${api}/messages`)).json() as {
        messages: { ID: string; To: { Address: string }[] }[]
      }
      messageId = list.messages.find((m) =>
        m.To.some((t) => t.Address === GUEST.email)
      )?.ID ?? ""
      return messageId !== ""
    })
    await recordMail(browser, timeline, messageId)

    const booked = `${TAKE}booked.png`
    const mail = `${TAKE}mail.png`
    await still(browser, confirmed, booked, HALF)
    await still(browser, `${MAIL}/view/${messageId}`, mail, HALF)

    // The closing split frame's caption runs from the end of the last shot.
    const last = HOLD.title +
      timeline.segments.reduce((s, x) => s + x.end - x.frames[0].at, 0)
    const cues: Cue[] = [
      ...timeline.cues,
      {
        start: last,
        end: last + HOLD.split,
        text: "One small container. Your bookings in one file",
      },
    ]
    const take: Take = { segments: timeline.segments, poster, booked, mail }
    await Deno.writeTextFile(`${TAKE}take.json`, JSON.stringify(take))
    await Deno.writeTextFile(CAPTIONS, toVtt(cues))
    // Paints closer together than 0.25 s are motion; their median shows the take's real frame rate.
    const gaps = timeline.segments.flatMap((s) =>
      s.frames.slice(1).map((f, i) => f.at - s.frames[i].at)
    ).filter((g) => g < 0.25).sort((a, b) => a - b)
    const median = gaps[Math.floor(gaps.length / 2)] ?? 0
    console.log(
      `take: ${gaps.length} paints in motion, median ${
        (median * 1000).toFixed(0)
      } ms apart`,
    )
  } finally {
    await browser?.close().catch(() => {})
    if (server) {
      try {
        server.kill("SIGTERM")
      } catch {
        // Already exited.
      }
      await server.status
    }
    if (containerStarted) {
      await must("docker", ["rm", "-f", container]).catch(() => {})
    }
  }
  await encode()
}

if (import.meta.main) await main()
