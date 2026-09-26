// Drives a local build of /embed in Chromium, inside an iframe on a
// parent page, and checks the behaviour mig#85 promises:
//
//   - with JavaScript, choosing a day and a time changes the view
//     without a page load, the address stays under /embed with its
//     `tz` and `theme`, and the frame posts a new `mig:height` after
//     each step;
//   - with JavaScript, the form still books and lands on
//     /embed/confirmed;
//   - without JavaScript, the same flow books end to end through
//     plain links and a form post.
//
//   deno task build && deno task embed:check
//
// Same setup as scripts/screenshots.ts: placeholder configuration, a
// throwaway data file, the in-process SMTP sink from local-app.ts, and
// Playwright pinned here instead of in deno.json (see that script's
// header for why it is imported through a variable). It needs
// Playwright 1.63.0's Chromium in ~/.cache/ms-playwright; AGENTS.md
// has the install command. CI has no Chromium, so this runs by hand.

import { freePort, startSmtpSink, waitForHealth } from "./local-app.ts";

const PLAYWRIGHT = "npm:playwright@1.63.0";
const ROOT = new URL("../", import.meta.url);
const VISITOR_TZ = "America/New_York";

// ─── Minimal Playwright types ───────────────────────────────────────

interface Locator {
  click(opts?: { force?: boolean }): Promise<void>;
  fill(value: string): Promise<void>;
  first(): Locator;
  count(): Promise<number>;
  nth(index: number): Locator;
  getAttribute(name: string): Promise<string | null>;
  waitFor(opts?: { state?: string; timeout?: number }): Promise<void>;
}

interface Frame {
  url(): string;
  locator(selector: string): Locator;
  evaluate(fn: string): Promise<unknown>;
  waitForURL(url: RegExp, opts?: { timeout?: number }): Promise<void>;
}

interface Page extends Frame {
  goto(url: string, opts?: { waitUntil?: string }): Promise<unknown>;
  setContent(html: string): Promise<void>;
  frames(): Frame[];
  waitForFunction(fn: string): Promise<unknown>;
}

interface BrowserContext {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

interface Browser {
  newContext(opts: Record<string, unknown>): Promise<BrowserContext>;
  close(): Promise<void>;
}

interface Playwright {
  chromium: { launch(opts: { args: string[] }): Promise<Browser> };
}

// ─── Checks ─────────────────────────────────────────────────────────

function check(ok: boolean, what: string): void {
  if (!ok) throw new Error(`FAILED: ${what}`);
  console.log(`ok - ${what}`);
}

const DATE_CELL =
  `section[aria-labelledby="step-date"] [aria-label$=" 16 slots available"]`;
const SLOT =
  `section[aria-labelledby="step-time"] :is(button, a):not([aria-disabled="true"])`;
const FORM = `form[aria-label="Booking details"]`;

/** The first fully bookable weekday after today, from the calendar. */
async function pickableDate(frame: Frame): Promise<string> {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
  }).format(new Date());
  const cells = frame.locator(DATE_CELL);
  await cells.first().waitFor();
  for (let i = 0; i < (await cells.count()); i++) {
    const date = (await cells.nth(i).getAttribute("aria-label"))?.split(" ")[0];
    if (date && date > today) return date;
  }
  throw new Error("the calendar shows no fully bookable weekday after today");
}

/** `force` skips Playwright's wait for the element to stop moving,
 *  which never finishes in a context with JavaScript disabled. */
async function fillForm(
  frame: Frame,
  name: string,
  email: string,
  force = false,
) {
  await frame.locator(`${FORM} input[name="name"]`).fill(name);
  await frame.locator(`${FORM} input[name="email"]`).fill(email);
  await frame.locator(`${FORM} button[type="submit"]`).click({ force });
}

/** The parent page: frames /embed and sizes it from `mig:height`,
 *  keeping every reported height in `window.heights`. */
function parentPage(src: string): string {
  return `<!doctype html><body style="margin:0">
<iframe id="mig" src="${src}" style="width:560px;height:200px;border:0"></iframe>
<script>
window.heights = [];
addEventListener("message", (e) => {
  if (e.data && e.data.type === "mig:height") {
    window.heights.push(e.data.height);
    document.getElementById("mig").style.height = e.data.height + "px";
  }
});
</script></body>`;
}

async function withJavaScript(browser: Browser, local: string, smtp: {
  mails: unknown[];
}) {
  const ctx = await browser.newContext({
    timezoneId: VISITOR_TZ,
    locale: "en-US",
    colorScheme: "light",
    viewport: { width: 800, height: 900 },
  });
  try {
    const page = await ctx.newPage();
    await page.setContent(parentPage(`${local}/embed?theme=dark`));
    const frameOf = () => {
      const f = page.frames().find((f) => f.url().includes("/embed"));
      if (!f) throw new Error("the /embed frame is missing");
      return f;
    };
    // The tz redirect (lib/guest-tz-script.ts) replaces the first load.
    await page.waitForFunction(`document.querySelector("iframe") !== null`);
    const frame = frameOf();
    await frame.waitForURL(/[?&]tz=/, { timeout: 15_000 });
    const date = await pickableDate(frame);
    // Hydrated: the calendar's days are buttons, not links.
    await frame.locator(
      `section[aria-labelledby="step-date"] button[aria-label^="${date} "]`,
    )
      .waitFor({ timeout: 15_000 });
    // A page load would drop this marker.
    await frame.evaluate(`window.__migNoReload = true`);
    const heights = async () =>
      (await page.evaluate(`window.heights`)) as number[];
    const settle = () => new Promise((r) => setTimeout(r, 400));
    await settle();
    const h0 = (await heights()).at(-1);

    await frame.locator(`button[aria-label^="${date} "]`).click();
    await frame.locator(SLOT).first().waitFor({ timeout: 15_000 });
    await settle();
    check(
      await frame.evaluate(`window.__migNoReload === true`) === true,
      "choosing a day changes the view without a page load",
    );
    const u1 = new URL(frame.url());
    check(
      u1.pathname === "/embed" && u1.searchParams.get("date") === date &&
        u1.searchParams.get("theme") === "dark" &&
        u1.searchParams.get("tz") === VISITOR_TZ,
      `the address stays under /embed with date, theme and tz (${u1.pathname}${u1.search})`,
    );
    const h1 = (await heights()).at(-1);
    check(
      h1 !== undefined && h1 !== h0,
      `the frame reports a new height after the day step (${h0} → ${h1})`,
    );

    const slot = frame.locator(
      `section[aria-labelledby="step-time"] button:not([disabled])`,
    ).first();
    await slot.click();
    await frame.locator(FORM).waitFor({ timeout: 15_000 });
    await settle();
    check(
      await frame.evaluate(`window.__migNoReload === true`) === true,
      "choosing a time changes the view without a page load",
    );
    const u2 = new URL(frame.url());
    check(
      u2.pathname === "/embed" && u2.searchParams.has("slot") &&
        u2.searchParams.get("theme") === "dark",
      `the address keeps the slot and theme (${u2.search})`,
    );
    const h2 = (await heights()).at(-1);
    check(
      h2 !== undefined && h2 !== h1,
      `the frame reports a new height after the time step (${h1} → ${h2})`,
    );
    check(
      await frame.locator(FORM).getAttribute("action") === "/embed/book",
      "the form posts to /embed/book",
    );
    check(
      await frame.locator(`${FORM} input[name="guestTz"]`).getAttribute(
            "value",
          ) === VISITOR_TZ &&
        await frame.locator(`${FORM} input[name="theme"]`).getAttribute(
            "value",
          ) === "dark",
      "the form carries the visitor's zone and the forced theme",
    );

    await frame.locator(`button[aria-label="Change date"]`).click();
    await frame.locator(DATE_CELL).first().waitFor();
    await settle();
    const h3 = (await heights()).at(-1);
    check(
      await frame.evaluate(`window.__migNoReload === true`) === true &&
        h3 !== undefined && h2 !== undefined && h3 < h2,
      `going back to the calendar shrinks the frame without a page load (${h2} → ${h3})`,
    );

    await frame.locator(`button[aria-label^="${date} "]`).click();
    await frame.locator(
      `section[aria-labelledby="step-time"] button:not([disabled])`,
    ).first()
      .click();
    const before = smtp.mails.length;
    await fillForm(frame, "John Doe", "john@example.com");
    await frame.waitForURL(/\/embed\/confirmed\?/, { timeout: 30_000 });
    check(
      new URL(frame.url()).searchParams.get("theme") === "dark" &&
        smtp.mails.length > before,
      "with JavaScript, the form books and lands on /embed/confirmed in the forced theme",
    );
  } finally {
    await ctx.close();
  }
}

async function withoutJavaScript(browser: Browser, local: string, smtp: {
  mails: unknown[];
}) {
  const ctx = await browser.newContext({
    javaScriptEnabled: false,
    timezoneId: VISITOR_TZ,
    locale: "en-US",
    viewport: { width: 800, height: 900 },
  });
  try {
    const page = await ctx.newPage();
    await page.goto(`${local}/embed`);
    const date = await pickableDate(page);
    await page.locator(`a[aria-label^="${date} "]`).click({ force: true });
    await page.waitForURL(/[?&]date=/);
    await page.locator(`section[aria-labelledby="step-time"] a`).first()
      .click({ force: true });
    await page.waitForURL(/[?&]slot=/);
    check(
      new URL(page.url()).pathname === "/embed",
      "without JavaScript, links stay under /embed",
    );
    const before = smtp.mails.length;
    await fillForm(page, "Jane Roe", "jane.roe@example.com", true);
    await page.waitForURL(/\/embed\/confirmed\?/, { timeout: 30_000 });
    check(
      smtp.mails.length > before,
      "without JavaScript, /embed books end to end",
    );
  } finally {
    await ctx.close();
  }
}

// ─── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    await Deno.stat(new URL("_fresh/server.js", ROOT));
  } catch {
    throw new Error("_fresh/server.js is missing: run `deno task build` first");
  }
  const { chromium } = (await import(PLAYWRIGHT)) as Playwright;
  const tmp = await Deno.makeTempDir({ prefix: "mig-embed-check-" });
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
        PUBLIC_URL: local,
        PORT: String(port),
        DATA_PATH: `${tmp}/bookings.json`,
        RATE_LIMIT_PER_5MIN: "100",
      },
      stdout: "null",
      stderr: "null",
    }).spawn();
    await waitForHealth(local, server);
    browser = await chromium.launch({
      // The parent page is about:blank framing a loopback address.
      args: ["--disable-features=LocalNetworkAccessChecks"],
    });
    await withJavaScript(browser, local, smtp);
    await withoutJavaScript(browser, local, smtp);
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
