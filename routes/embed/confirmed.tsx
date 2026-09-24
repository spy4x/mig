// /embed/confirmed — the /embed variant of /confirmed.
//
// Same lookup (lib/confirmed-data.ts), same ConfirmedView body — no
// Header, no Footer, no theme toggle (the parent page owns the
// chrome; see routes/embed/index.tsx). "Book another time" stays
// under /embed. The meeting link and the cancel link open in a new
// tab: both are pages a host that only allows framing /embed would
// refuse to render inside the iframe (issue #11).

import { define } from "../../lib/utils.ts";
import { loadConfirmedData } from "../../lib/confirmed-data.ts";
import { ConfirmedView } from "../../components/ConfirmedView.tsx";
import { pickerHref } from "../../lib/picker-links.ts";
import { parseThemeParam } from "../../lib/theme.ts";
import {
  HEIGHT_ATTR,
  heightReportScript,
} from "../../lib/height-report-script.ts";

export const handler = define.handlers({
  async GET(ctx) {
    return { data: await loadConfirmedData(ctx) };
  },
});

export default define.page<typeof handler>(
  function EmbedConfirmed({ data, state, url }) {
    const cfg = state.config;

    // Forced theme (mig#44) — same normalization as routes/embed/
    // index.tsx, so "Book another time" carries it back to /embed.
    const themeParam = parseThemeParam(url.searchParams.get("theme"));
    const theme = themeParam === "auto" ? null : themeParam;

    return (
      // No min-h-dvh — same reasoning as routes/embed/index.tsx
      // (mig#44). data-mig-height marks this wrapper as the element
      // heightReportScript measures — it wraps whichever <main>
      // ConfirmedView renders (not-ok, cancelled, or booked), so all
      // three states report their own real height. Losing min-h-dvh
      // also means the not-ok and cancelled states' `place-items-center`
      // no longer has extra height to center within — intended: a
      // frame sized to this element's content has no such space.
      <div class="flex flex-col bg-surface text-ink" {...{ [HEIGHT_ATTR]: "" }}>
        {
          /* mig#44 — see routes/embed/index.tsx for why this runs on
             every /embed page. */
        }
        <script
          dangerouslySetInnerHTML={{ __html: heightReportScript() }}
        />
        <ConfirmedView
          {...data}
          hostName={cfg.hostName}
          meetingUrl={cfg.meetingUrl}
          slotDurationMin={cfg.slotDurationMin}
          backHref={pickerHref("/embed", undefined, null, theme)}
          cancelTarget="_blank"
          cancelledMainClass="flex-1 grid place-items-center px-4 sm:px-5 py-4 sm:py-5"
          mainId="main"
        />
      </div>
    );
  },
);
