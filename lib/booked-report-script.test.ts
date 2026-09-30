// Runs bookedReportScript()'s real source against a fake `window`,
// the same way lib/height-report-script.test.ts does.

import { assertEquals } from "@std/assert";
import { bookedReportScript } from "./booked-report-script.ts";

interface FakeWindow {
  parent: FakeWindow;
  sessionStorage: {
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
  } | null;
  postMessage: (msg: unknown, targetOrigin: string) => void;
  posted: Array<{ msg: unknown; targetOrigin: string }>;
}

function fakeWindow(
  opts: {
    framed: boolean;
    store?: Map<string, string>;
    storageThrows?: boolean;
  },
): FakeWindow {
  const store = opts.store ?? new Map<string, string>();
  const posted: FakeWindow["posted"] = [];
  const self: FakeWindow = {
    parent: undefined as unknown as FakeWindow,
    sessionStorage: {
      getItem(k) {
        if (opts.storageThrows) throw new Error("blocked");
        return store.get(k) ?? null;
      },
      setItem(k, v) {
        if (opts.storageThrows) throw new Error("blocked");
        store.set(k, v);
      },
    },
    postMessage(msg, targetOrigin) {
      posted.push({ msg, targetOrigin });
    },
    posted,
  };
  self.parent = opts.framed
    ? ({ postMessage: self.postMessage } as unknown as FakeWindow)
    : self;
  return self;
}

function run(win: FakeWindow, id = "abc123") {
  new Function("window", bookedReportScript(id))(win);
}

Deno.test("bookedReportScript: posts exactly { type: 'mig:booked' } to the parent with target origin *", () => {
  const win = fakeWindow({ framed: true });
  run(win);
  assertEquals(win.posted.length, 1);
  assertEquals(win.posted[0].msg, { type: "mig:booked" });
  assertEquals(Object.keys(win.posted[0].msg as object), ["type"]);
  assertEquals(win.posted[0].targetOrigin, "*");
});

Deno.test("bookedReportScript: never puts the booking id in the message", () => {
  const win = fakeWindow({ framed: true });
  run(win, "secret-id-777");
  assertEquals(
    JSON.stringify(win.posted[0].msg).includes("secret-id-777"),
    false,
  );
});

Deno.test("bookedReportScript: a reload of the same booking posts nothing", () => {
  const store = new Map<string, string>();
  const first = fakeWindow({ framed: true, store });
  run(first);
  const reload = fakeWindow({ framed: true, store });
  run(reload);
  assertEquals(first.posted.length, 1);
  assertEquals(reload.posted.length, 0);
});

Deno.test("bookedReportScript: a different booking in the same session posts again", () => {
  const store = new Map<string, string>();
  run(fakeWindow({ framed: true, store }), "one");
  const second = fakeWindow({ framed: true, store });
  run(second, "two");
  assertEquals(second.posted.length, 1);
});

Deno.test("bookedReportScript: never posts when top-level", () => {
  const win = fakeWindow({ framed: false });
  run(win);
  assertEquals(win.posted.length, 0);
});

Deno.test("bookedReportScript: still posts when sessionStorage is blocked", () => {
  const win = fakeWindow({ framed: true, storageThrows: true });
  run(win);
  assertEquals(win.posted.length, 1);
});

Deno.test("bookedReportScript: an id with quotes or </script> cannot break out of the script", () => {
  const id = `x"</script><script>alert(1)//`;
  const src = bookedReportScript(id);
  assertEquals(src.includes("</script"), false);
  const win = fakeWindow({ framed: true });
  run(win, id);
  assertEquals(win.posted.length, 1);
});

Deno.test("bookedReportScript: a thrown error inside is swallowed", () => {
  const win = fakeWindow({ framed: true });
  win.parent = null as unknown as FakeWindow;
  run(win);
});
