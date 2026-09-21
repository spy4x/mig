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

export const handler = define.handlers({
  async GET(ctx) {
    return { data: await loadConfirmedData(ctx) };
  },
});

export default define.page<typeof handler>(
  function EmbedConfirmed({ data, state }) {
    const cfg = state.config;

    return (
      <div class="min-h-dvh flex flex-col bg-surface text-ink">
        <ConfirmedView
          {...data}
          hostName={cfg.hostName}
          meetingUrl={cfg.meetingUrl}
          slotDurationMin={cfg.slotDurationMin}
          backHref="/embed"
          cancelTarget="_blank"
        />
      </div>
    );
  },
);
