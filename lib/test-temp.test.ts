import { assertEquals, assertRejects } from "@std/assert"
import { BookingsStore } from "./bookings.ts"
import { tempDataFile } from "./test-temp.ts"

Deno.test("tempDataFile: a store opens the new file as an empty list", async () => {
  await using file = await tempDataFile()
  assertEquals(await Deno.readTextFile(file.path), "[]")
  const store = new BookingsStore({ filePath: file.path })
  await store.init()
  assertEquals(store.list(), [])
})

Deno.test("tempDataFile: two files never share a name", async () => {
  await using a = await tempDataFile()
  await using b = await tempDataFile()
  assertEquals(a.path === b.path, false)
})

Deno.test("tempDataFile: the file is removed when its scope ends", async () => {
  let path: string
  {
    await using file = await tempDataFile()
    path = file.path
    assertEquals((await Deno.stat(path)).isFile, true)
  }
  await assertRejects(() => Deno.stat(path), Deno.errors.NotFound)
})

Deno.test("tempDataFile: the file is removed when the scope ends by a throw", async () => {
  let path = ""
  await assertRejects(
    async () => {
      await using file = await tempDataFile()
      path = file.path
      throw new Error("test failed")
    },
    Error,
    "test failed",
  )
  await assertRejects(() => Deno.stat(path), Deno.errors.NotFound)
})

Deno.test("tempDataFile: a file the test already removed does not fail the scope's end", async () => {
  await using file = await tempDataFile()
  await Deno.remove(file.path)
})
