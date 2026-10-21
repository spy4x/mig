// Encodes the last raw take (media/demo/take/, written by record.ts) into
// media/demo/: demo.webm, demo.mp4, poster.webp and poster-640.webp. Runs on
// its own, so a caption or music change needs no new recording:
//
//   deno task demo-video:encode
//
// It draws the title and end cards and one band per caption in Chromium (in
// mig's own Geist), then ffmpeg plays the take back in real time between the
// cards, closes on "You're booked" beside the email, lays each caption band
// over its time from captions.vtt, and mixes music.opus under it all at about
// -28 LUFS. It refuses captions that leave too soon, a louder mix, a file over
// its size budget, or an output that is not 30 fps with sound.

import {
  BAND,
  CAPTIONS,
  type Cue,
  FPS,
  HOLD,
  launch,
  MUSIC,
  must,
  OUT,
  paceProblems,
  parseVtt,
  resample,
  ROOT,
  SIZE,
  TAKE,
  type Take,
} from "./shared.ts"

/** The page colour of mig's dark theme, behind the cards and between the split halves. */
const INK = "#080b10"
/** The mix the encoder aims for and the loudest it accepts: LUFS integrated, dBTP. */
const LOUDNESS = { target: -28, most: -27, peak: -1 }
/** Bytes each file may weigh. */
const BUDGET = { webm: 3_000_000, mp4: 3_000_000 }
const TITLE = {
  claim: "A tiny self-hosted meeting scheduler.",
  sub: "One owner, one link, no database.",
}
const END = {
  claim: "github.com/spy4x/mig",
  sub: "Free and open source, AGPL-3.0",
}

/** The HTML the cards and caption bands are drawn from. */
function page(font: string, body: string, background: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: Geist; src: url("${font}") format("woff2"); font-weight: 100 900 }
    html, body { margin: 0; width: ${SIZE.width}px; height: ${SIZE.height}px; overflow: hidden;
      background: ${background}; font-family: Geist, sans-serif; color: #fff }
    .card { height: 100%; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 28px; text-align: center; padding: 0 120px; box-sizing: border-box }
    .brand { display: flex; align-items: center; gap: 18px; font-size: 52px; font-weight: 600;
      letter-spacing: -0.02em }
    .brand svg { width: 64px; height: 64px }
    h1 { margin: 0; font-size: 52px; line-height: 1.15; font-weight: 600; letter-spacing: -0.03em;
      color: #fafafa; text-wrap: balance }
    p { margin: 0; font-size: 28px; font-weight: 500; color: #a1a1aa }
    .band { position: absolute; left: 0; right: 0; height: ${BAND}px; display: flex;
      align-items: center; justify-content: center; font-size: 32px; font-weight: 500;
      letter-spacing: -0.01em; background: oklch(0.15 0.012 260 / 0.78) }
  </style></head><body>${body}</body></html>`
}

/** Draws the cards and one transparent PNG per caption into `dir`. */
async function drawOverlays(dir: string, cues: Cue[]) {
  const font = `data:font/woff2;base64,${
    btoa(
      Array.from(
        await Deno.readFile(`${ROOT}static/fonts/Geist-Variable.woff2`),
        (b) => String.fromCharCode(b),
      ).join(""),
    )
  }`
  const mark = await Deno.readTextFile(`${ROOT}static/favicon.svg`)
  const card = (c: { claim: string; sub: string }) =>
    `<div class="card"><div class="brand">${mark}<span>mig</span></div><h1>${c.claim}</h1><p>${c.sub}</p></div>`
  const escape = (s: string) =>
    s.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)
  const browser = await launch()
  try {
    const ctx = await browser.newContext({
      viewport: SIZE,
      deviceScaleFactor: 1,
    })
    const tab = await ctx.newPage()
    const draw = async (html: string, path: string, transparent = false) => {
      await tab.setContent(html, { waitUntil: "load" })
      await tab.evaluate("document.fonts.ready")
      await tab.screenshot({ path, omitBackground: transparent })
    }
    await draw(page(font, card(TITLE), INK), `${dir}/title.png`)
    await draw(page(font, card(END), INK), `${dir}/end.png`)
    for (const [i, cue] of cues.entries()) {
      const where = cue.top ? "top: 0" : "bottom: 0"
      await draw(
        page(
          font,
          `<div class="band" style="${where}">${escape(cue.text)}</div>`,
          "transparent",
        ),
        `${dir}/caption-${i}.png`,
        true,
      )
    }
  } finally {
    await browser.close()
  }
}

/** Seconds of a media file, read with ffprobe. */
async function duration(file: string): Promise<number> {
  const out = await must("ffprobe", [
    ...[
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      file,
    ],
  ])
  return Number(out.trim())
}

/** Integrated loudness (LUFS) and true peak (dBTP) of a file's sound, by EBU R 128. */
async function loudness(
  file: string,
  filter = "anull",
): Promise<{ lufs: number; peak: number }> {
  const out = await new Deno.Command("ffmpeg", {
    args: [
      ...["-hide_banner", "-nostats", "-i", file, "-map", "0:a"],
      ...["-af", `${filter},ebur128=peak=true`, "-f", "null", "-"],
    ],
    stdout: "null",
    stderr: "piped",
  }).output()
  const text = new TextDecoder().decode(out.stderr)
  const summary = text.slice(text.lastIndexOf("Summary:"))
  const lufs = summary.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]
  const peak = summary.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1]
  if (!out.success || !lufs || !peak) {
    throw new Error(`could not measure ${file}:\n${text.slice(-2000)}`)
  }
  return { lufs: Number(lufs), peak: Number(peak) }
}

/** The 1280×800 master: title card, the shots, the split frame, the end card, with captions. */
async function master(
  take: Take,
  cues: Cue[],
  dir: string,
  seconds: number,
): Promise<string> {
  // The take as a steady 30 fps sequence: hard links to the frame on screen at each tick.
  await Deno.mkdir(`${dir}/seq`)
  for (const [i, file] of resample(take.segments).entries()) {
    await Deno.link(file, `${dir}/seq/${String(i).padStart(6, "0")}.jpg`)
  }
  const still = (
    file: string,
    t: number,
  ) => ["-loop", "1", "-framerate", String(FPS), "-t", String(t), "-i", file]
  const norm =
    `fps=${FPS},scale=${SIZE.width}:${SIZE.height}:flags=lanczos,setsar=1,format=yuv420p`
  const half = `scale=636:800:flags=lanczos,setsar=1,format=yuv420p`
  const filters = [
    `[0:v]${norm}[rec]`,
    `[1:v]${norm}[title]`,
    `[2:v]${half},pad=644:800:0:0:color=${INK}[left]`,
    `[3:v]${half}[right]`,
    `[left][right]hstack,${norm}[split]`,
    `[4:v]${norm}[end]`,
    `[title][rec][split][end]concat=n=4:v=1:a=0[base0]`,
  ]
  const fade = 0.2
  cues.forEach((c, i) => {
    const len = c.end - c.start
    filters.push(
      `[${5 + i}:v]format=rgba,fade=t=in:st=0:d=${fade}:alpha=1,` +
        `fade=t=out:st=${(len - fade).toFixed(3)}:d=${fade}:alpha=1,` +
        `setpts=PTS+${c.start.toFixed(3)}/TB[cap${i}]`,
      `[base${i}][cap${i}]overlay=0:0:eof_action=pass:format=auto[base${
        i + 1
      }]`,
    )
  })
  const out = `${dir}/master.mkv`
  await must("ffmpeg", [
    ...["-y", "-hide_banner", "-loglevel", "error"],
    ...["-framerate", String(FPS), "-i", `${dir}/seq/%06d.jpg`],
    ...still(`${dir}/title.png`, HOLD.title),
    ...still(take.booked, HOLD.split),
    ...still(take.mail, HOLD.split),
    ...still(`${dir}/end.png`, HOLD.end),
    ...cues.flatMap((c, i) =>
      still(`${dir}/caption-${i}.png`, c.end - c.start)
    ),
    ...["-filter_complex", filters.join(";"), "-map", `[base${cues.length}]`],
    ...["-t", seconds.toFixed(3), "-r", String(FPS), "-c:v", "ffv1", out],
  ])
  return out
}

/** Encodes the master with the music under it, trying each quality until the file fits. */
async function encodeFile(
  video: string,
  music: string,
  out: string,
  budget: number,
  codec: (q: number) => string[],
  qualities: number[],
): Promise<number> {
  for (const q of qualities) {
    await must("ffmpeg", [
      ...["-y", "-hide_banner", "-loglevel", "error", "-i", video, "-i", music],
      ...[
        "-map",
        "0:v",
        "-map",
        "1:a",
        "-map_metadata",
        "-1",
        "-r",
        String(FPS),
      ],
      ...codec(q),
      out,
    ])
    const { size } = await Deno.stat(out)
    if (size <= budget) return size
  }
  throw new Error(`${out} stays above its budget of ${budget} bytes`)
}

async function poster(src: string, width: number, out: string) {
  await must("ffmpeg", [
    ...["-y", "-hide_banner", "-loglevel", "error", "-i", src],
    ...[
      "-vf",
      `scale=${width}:-1:flags=lanczos`,
      "-c:v",
      "libwebp",
      "-quality",
      "85",
    ],
    ...["-map_metadata", "-1", out],
  ])
}

/** Fails unless `file` is 30 fps, has a sound stream and lasts `seconds`. */
async function verify(file: string, seconds: number) {
  const probe = JSON.parse(
    await must("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      file,
    ]),
  ) as {
    streams: { codec_type: string; r_frame_rate: string }[]
    format: { duration: string }
  }
  const video = probe.streams.find((s) => s.codec_type === "video")
  if (video?.r_frame_rate !== `${FPS}/1`) {
    throw new Error(`${file} is not ${FPS} fps`)
  }
  if (!probe.streams.some((s) => s.codec_type === "audio")) {
    throw new Error(`${file} has no sound`)
  }
  const length = Number(probe.format.duration)
  if (Math.abs(length - seconds) > 0.2) {
    throw new Error(
      `${file} lasts ${length.toFixed(2)} s, expected ${seconds.toFixed(2)} s`,
    )
  }
}

export async function encode() {
  const take = JSON.parse(await Deno.readTextFile(`${TAKE}take.json`)) as Take
  const cues = parseVtt(await Deno.readTextFile(CAPTIONS))
  const late = paceProblems(cues)
  if (late.length) {
    throw new Error(`captions leave too soon:\n${late.join("\n")}`)
  }
  const shots = take.segments.reduce((s, x) => s + x.end - x.frames[0].at, 0)
  const seconds = HOLD.title + shots + HOLD.split + HOLD.end
  if (await duration(MUSIC) < seconds) {
    throw new Error(`music.opus is shorter than ${seconds} s`)
  }

  const dir = `${TAKE}encode`
  await Deno.remove(dir, { recursive: true }).catch(() => {})
  await Deno.mkdir(dir, { recursive: true })
  await drawOverlays(dir, cues)
  const video = await master(take, cues, dir, seconds)

  // Trimmed, faded in over 1 s and out over 2 s, then levelled to the target.
  const shape = [
    `atrim=0:${seconds.toFixed(3)}`,
    "afade=t=in:d=1",
    `afade=t=out:st=${(seconds - 2).toFixed(3)}:d=2`,
  ].join(",")
  const raw = await loudness(MUSIC, shape)
  const gain = LOUDNESS.target - raw.lufs
  const music = `${dir}/music.wav`
  await must("ffmpeg", [
    ...["-y", "-hide_banner", "-loglevel", "error", "-i", MUSIC],
    ...["-af", `${shape},volume=${gain.toFixed(2)}dB`, "-ar", "48000", music],
  ])

  const webm = await encodeFile(
    video,
    music,
    `${OUT}demo.webm`,
    BUDGET.webm,
    (crf) => [
      ...[
        "-c:v",
        "libvpx-vp9",
        "-b:v",
        "0",
        "-crf",
        String(crf),
        "-row-mt",
        "1",
      ],
      ...["-deadline", "good", "-cpu-used", "2", "-pix_fmt", "yuv420p"],
      ...["-c:a", "libopus", "-b:a", "96k"],
    ],
    [36, 40, 44],
  )
  const mp4 = await encodeFile(
    video,
    music,
    `${OUT}demo.mp4`,
    BUDGET.mp4,
    (crf) => [
      ...[
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-tune",
        "stillimage",
        "-crf",
        String(crf),
      ],
      ...[
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
      ],
    ],
    [24, 27, 30],
  )
  for (const f of ["demo.webm", "demo.mp4"]) {
    await verify(`${OUT}${f}`, seconds)
    const sound = await loudness(`${OUT}${f}`)
    if (sound.lufs > LOUDNESS.most || sound.peak > LOUDNESS.peak) {
      throw new Error(
        `${f} is too loud: ${sound.lufs} LUFS, true peak ${sound.peak} dBTP`,
      )
    }
    console.log(
      `${f}: ${sound.lufs} LUFS integrated, true peak ${sound.peak} dBTP`,
    )
  }
  await poster(take.poster, 1280, `${OUT}poster.webp`)
  await poster(take.poster, 640, `${OUT}poster-640.webp`)
  const kb = async (f: string) =>
    `${((await Deno.stat(`${OUT}${f}`)).size / 1024).toFixed(0)} KB`
  console.log(
    `${seconds.toFixed(1)} s; demo.webm ${
      (webm / 1024).toFixed(0)
    } KB, demo.mp4 ${(mp4 / 1024).toFixed(0)} KB, poster.webp ${await kb(
      "poster.webp",
    )}, poster-640.webp ${await kb("poster-640.webp")}`,
  )
}

if (import.meta.main) await encode()
