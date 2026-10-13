// A throwaway bookings file for a test. The name comes from the
// runtime (`Deno.makeTempFile`), so no test invents its own, and the
// file is removed when the `await using` scope that holds it ends,
// whether the test passed or threw.

export interface TempDataFile extends AsyncDisposable {
  /** Absolute path of the file, under the runtime's temp directory. */
  path: string;
}

/**
 * Creates a bookings file that holds an empty list, which is what
 * `BookingsStore` reads as "no bookings yet". A file with no content
 * at all would be refused as invalid JSON.
 *
 * Hold it with `await using`: leaving the scope removes the file. A
 * test that already removed it itself is fine.
 */
export async function tempDataFile(): Promise<TempDataFile> {
  const path = await Deno.makeTempFile({
    prefix: "mig-test-",
    suffix: ".json",
  });
  await Deno.writeTextFile(path, "[]");
  return {
    path,
    async [Symbol.asyncDispose]() {
      try {
        await Deno.remove(path);
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) throw err;
      }
    },
  };
}
