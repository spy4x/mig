import { assertEquals } from "@std/assert"
import { type Cue, paceProblems, parseVtt, resample, toVtt } from "./shared.ts"

Deno.test("captions survive a round trip through WebVTT, top band included", () => {
  const cues: Cue[] = [
    { start: 2, end: 4.75, text: "They pick a free day" },
    {
      start: 4.75,
      end: 7.5,
      text: "A calendar invite comes attached",
      top: true,
    },
  ]
  const vtt = toVtt(cues)
  assertEquals(vtt.split("\n")[0], "WEBVTT")
  assertEquals(vtt.includes("00:00:04.750 --> 00:00:07.500 line:0"), true)
  assertEquals(parseVtt(vtt), cues)
})

Deno.test("a caption that leaves before it can be read is reported", () => {
  const long = "It has the time, the meeting link and a cancel link" // 51 chars: 3.4 s
  assertEquals(paceProblems([{ start: 0, end: 2.5, text: "Booked" }]), [])
  assertEquals(paceProblems([{ start: 0, end: 2.4, text: "Booked" }]).length, 1)
  assertEquals(paceProblems([{ start: 0, end: 3.4, text: long }]), [])
  assertEquals(paceProblems([{ start: 0, end: 3, text: long }]).length, 1)
})

Deno.test("the take plays back in real time at a steady frame rate", () => {
  // Two shots: paints at uneven times, then a still screen, at 10 fps.
  const files = resample([
    {
      frames: [{ file: "a", at: 100 }, { file: "b", at: 100.05 }, {
        file: "c",
        at: 100.31,
      }],
      end: 100.5,
    },
    { frames: [{ file: "d", at: 200 }], end: 200.3 },
  ], 10)
  assertEquals(files, ["a", "b", "b", "b", "c", "d", "d", "d"])
})

Deno.test("a caption longer than one line is reported", () => {
  assertEquals(paceProblems([{ start: 0, end: 10, text: "x".repeat(64) }]), [])
  assertEquals(
    paceProblems([{ start: 0, end: 10, text: "x".repeat(65) }]).length,
    1,
  )
})
