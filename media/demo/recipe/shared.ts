// What the recorder and the encoder agree on: where the raw take lives, how
// long the cards hold, and the caption file's format and pace rules.

/** The repository root. */
export const ROOT = new URL("../../../", import.meta.url).pathname
/** The committed outputs: the videos, posters, captions and music. */
export const OUT = `${ROOT}media/demo/`
/** The last raw take (gitignored): frames, stills and `take.json`. */
export const TAKE = `${ROOT}media/demo/take/`
export const CAPTIONS = `${OUT}captions.vtt`
export const MUSIC = `${OUT}music.opus`
/** Pinned outside deno.json's imports, as in scripts/screenshots.ts. */
export const PLAYWRIGHT = "npm:playwright@1.63.0"

export const FPS = 30
export const SIZE = { width: 1280, height: 800 }
/** Seconds the title card, the closing split frame and the end card hold. */
export const HOLD = { title: 2, split: 4.5, end: 2.5 }
/** The caption band's height, in pixels of the 1280×800 frame. */
export const BAND = 84

/** One painted frame of the raw take and when it was painted, in seconds. */
export interface Frame {
  file: string
  at: number
}

/** One continuous shot: its frames, and when it ended. */
export interface Segment {
  frames: Frame[]
  end: number
}

/** What `take.json` holds, beside the frames and stills it names. */
export interface Take {
  segments: Segment[]
  /** The opening screen without the pointer, for the posters. */
  poster: string
  /** "You're booked" and the email at half width, for the closing split frame. */
  booked: string
  mail: string
}

/**
 * The take at a steady frame rate, shots back to back in real time: for each
 * tick, the file of the last frame painted by then. A frame painted between two
 * ticks shows from the next one; a shot's last frame holds until the shot ended.
 */
export function resample(segments: Segment[], fps = FPS): string[] {
  const files: string[] = []
  let carry = 0
  for (const { frames, end } of segments) {
    const start = frames[0].at
    const ticks = Math.round((end - start + carry) * fps)
    carry += end - start - ticks / fps
    let k = 0
    for (let n = 0; n < ticks; n++) {
      const t = start + n / fps
      while (k + 1 < frames.length && frames[k + 1].at <= t) k++
      files.push(frames[k].file)
    }
  }
  return files
}

/** One caption: seconds from the start of the final video, and its text. */
export interface Cue {
  start: number
  end: number
  text: string
  /** Shows the band at the top of the frame, over a shot whose subject is at the bottom. */
  top?: boolean
}

/** A caption must stay at least this long, and long enough to read at this pace. */
export const MIN_CUE_SECONDS = 2.5
export const READ_CHARS_PER_SECOND = 15

/** How long `text` must stay on screen. */
export function cueSeconds(text: string): number {
  return Math.max(MIN_CUE_SECONDS, text.length / READ_CHARS_PER_SECOND)
}

/** Every caption that leaves the screen before it can be read, as a sentence each. */
export function paceProblems(cues: Cue[]): string[] {
  return cues.flatMap((c) => {
    const shown = c.end - c.start
    const need = cueSeconds(c.text)
    return shown + 0.001 < need
      ? [`"${c.text}" shows ${shown.toFixed(2)} s, needs ${need.toFixed(2)} s`]
      : []
  })
}

function stamp(seconds: number): string {
  const ms = Math.round(seconds * 1000)
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, "0")
  const m = String(Math.floor(ms / 60_000) % 60).padStart(2, "0")
  const s = String(Math.floor(ms / 1000) % 60).padStart(2, "0")
  return `${h}:${m}:${s}.${String(ms % 1000).padStart(3, "0")}`
}

function seconds(stamp: string): number {
  const [h, m, s] = stamp.split(":").map(Number)
  return h * 3600 + m * 60 + s
}

/** WebVTT text for `cues`; a top-band cue carries `line:0`. */
export function toVtt(cues: Cue[]): string {
  const blocks = cues.map((c) =>
    `${stamp(c.start)} --> ${stamp(c.end)}${c.top ? " line:0" : ""}\n${c.text}`
  )
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`
}

/** The cues of a WebVTT file as `toVtt` writes it: one line of text per cue. */
export function parseVtt(vtt: string): Cue[] {
  const cues: Cue[] = []
  for (const block of vtt.replaceAll("\r", "").split(/\n{2,}/)) {
    const lines = block.trim().split("\n")
    const i = lines.findIndex((l) => l.includes("-->"))
    if (i === -1) continue
    const m = lines[i].match(/^(\S+)\s+-->\s+(\S+)(.*)$/)
    if (!m) throw new Error(`unreadable cue timing: ${lines[i]}`)
    const text = lines.slice(i + 1).join(" ").trim()
    if (!text) throw new Error(`cue at ${m[1]} has no text`)
    cues.push({
      start: seconds(m[1]),
      end: seconds(m[2]),
      text,
      ...(/\bline:0\b/.test(m[3]) ? { top: true } : {}),
    })
  }
  return cues
}

/** Runs a command to the end and returns its stdout, or throws with its stderr. */
export async function must(cmd: string, args: string[]): Promise<string> {
  const out = await new Deno.Command(cmd, {
    args,
    stdout: "piped",
    stderr: "piped",
  })
    .output()
  const text = new TextDecoder()
  if (!out.success) {
    throw new Error(`${cmd} failed:\n${text.decode(out.stderr).slice(-3000)}`)
  }
  return text.decode(out.stdout)
}

// ─── Minimal Playwright types ────────────────────────────────────────
// Playwright is imported through a variable (see scripts/screenshots.ts for
// why), so these stand in for its own types.

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface Locator {
  boundingBox(): Promise<Box | null>
  waitFor(opts?: { state?: string; timeout?: number }): Promise<void>
  filter(opts: { hasText?: string | RegExp; visible?: boolean }): Locator
  first(): Locator
  nth(index: number): Locator
  count(): Promise<number>
  getAttribute(name: string): Promise<string | null>
}

export interface Page {
  goto(url: string, opts?: { waitUntil?: string }): Promise<unknown>
  setContent(html: string, opts?: { waitUntil?: string }): Promise<void>
  locator(selector: string): Locator
  getByRole(role: string, opts: { name: RegExp | string }): Locator
  getByText(text: string): Locator
  url(): string
  evaluate(script: string): Promise<unknown>
  waitForTimeout(ms: number): Promise<void>
  waitForURL(url: RegExp, opts?: { timeout?: number }): Promise<void>
  waitForLoadState(state: string): Promise<void>
  screenshot(opts: { path: string; omitBackground?: boolean }): Promise<unknown>
  mouse: {
    move(x: number, y: number): Promise<void>
    down(): Promise<void>
    up(): Promise<void>
    wheel(dx: number, dy: number): Promise<void>
  }
  keyboard: { type(text: string, opts?: { delay?: number }): Promise<void> }
}

export interface CDPSession {
  on(
    event: "Page.screencastFrame",
    fn: (
      e: { data: string; sessionId: number; metadata: { timestamp?: number } },
    ) => void,
  ): void
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
}

export interface BrowserContext {
  newPage(): Promise<Page>
  newCDPSession(page: Page): Promise<CDPSession>
  addInitScript(script: string): Promise<void>
  close(): Promise<void>
}

export interface Browser {
  newContext(opts: {
    viewport: { width: number; height: number }
    deviceScaleFactor: number
    timezoneId?: string
    locale?: string
    colorScheme?: "dark" | "light"
  }): Promise<BrowserContext>
  close(): Promise<void>
}

export async function launch(args: string[] = []): Promise<Browser> {
  const { chromium } = (await import(PLAYWRIGHT)) as {
    chromium: { launch(opts: { args: string[] }): Promise<Browser> }
  }
  return chromium.launch({ args })
}
