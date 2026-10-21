# Remaking the demo video

The video shows a guest booking a meeting with a local mig, landing on "You're
booked", and the confirmation email opening in a local Mailpit. Everything on
screen is staged: "Jane Doe", "John Doe", example.com addresses and
Europe/Berlin. Nothing leaves the machine.

## What it needs

- Deno, and this checkout's dependencies (`deno install --frozen`).
- Docker, for a throwaway Mailpit container (`axllent/mailpit:v1.31.3`, pinned
  by digest in `record.ts`).
- Playwright 1.63.0's Chromium:
  `deno run -A --node-modules-dir=none --no-lock npm:playwright@1.63.0 install chromium`.
- `ffmpeg` with libvpx-vp9, libx264, libopus, aac and libwebp.

## Steps

1. Remake everything, about two minutes:

   ```bash
   deno task demo-video
   ```

   It builds the app, starts it and Mailpit with placeholder settings, records
   the booking and the email into `media/demo/take/` (gitignored), writes
   `media/demo/captions.vtt` with each caption timed to its step, and runs the
   encoder. The booking takes the first day whose 15:30 is still free, so the
   dates on screen follow the day you run it.

2. To change only a caption's wording, the cards or the music, edit
   `media/demo/captions.vtt`, `encode.ts` or `media/demo/music.opus`, then
   re-encode the last take, about a minute:

   ```bash
   deno task demo-video:encode
   ```

   A cue with `line:0` after its times shows its band at the top of the frame.

3. Look before you commit: make a contact sheet and check every frame for
   readable captions, the title and end cards, and only staged data.

   ```bash
   ffmpeg -i media/demo/demo.mp4 -vf "fps=1,scale=320:-1,tile=6x8" -frames:v 1 sheet.png
   ```

4. Commit `media/demo/` (the take stays out of git).

## What the encoder checks

It refuses to write the video when a caption leaves the screen before it can be
read (2.5 s at least, and 15 characters a second), when the music is shorter
than the video, when a file is over 3 MB, when the mix is louder than -27 LUFS
integrated or -1 dBTP true peak (it aims for -28 LUFS), or when an output is not
30 fps with a sound track of the expected length.

## Files

- `record.ts`: the steps on screen, the captions' wording and timing, and the
  staged settings.
- `encode.ts`: the title and end cards, the caption bands, the closing split
  frame, the music mix and the encoders.
- `shared.ts`: paths, hold times, the caption format and pace rules.
