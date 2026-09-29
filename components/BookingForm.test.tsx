import { assert, assertEquals } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import { BookingForm } from "./BookingForm.tsx";

function render(basePath: string): string {
  return renderToString(
    <BookingForm
      date="2027-01-04"
      slot="09:00"
      dateLabel="Monday, 4 January 2027"
      durationMin={30}
      hostName="Jane Doe"
      confirmLabel="Confirm — Mon, 4 Jan, 09:00"
      basePath={basePath}
    />,
  );
}

// lib/book.ts reads the honeypot from the form field `website`; a
// rename here would silently switch the bot trap off.
for (const base of ["", "/embed"]) {
  Deno.test(`BookingForm on ${base || "/"}: the honeypot is a hidden, untabbable input named website`, () => {
    const html = render(base);
    const wrapper = html.match(
      /<div[^>]*aria-hidden="true"[^>]*>\s*<label>[^<]*<input[^>]*name="website"[^>]*>/,
    );
    assert(wrapper, "expected an aria-hidden wrapper around name=website");
    assert(/tabindex="-1"/i.test(wrapper[0]));
    assertEquals(html.match(/name="website"/g)?.length, 1);
  });
}
