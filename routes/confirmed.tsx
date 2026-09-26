import { define } from "../lib/utils.ts";
import { loadConfirmedData } from "../lib/confirmed-data.ts";
import { Header } from "../components/Header.tsx";
import { Footer } from "../components/Footer.tsx";
import { ConfirmedView } from "../components/ConfirmedView.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    return { data: await loadConfirmedData(ctx) };
  },
});

export default define.page<typeof handler>(function Confirmed({ data, state }) {
  const cfg = state.config;

  return (
    <div class="min-h-dvh flex flex-col">
      <Header compact defaultTheme={cfg.theme} />
      <ConfirmedView
        {...data}
        hostName={cfg.hostName}
        meetingUrl={cfg.meetingUrl}
        slotDurationMin={cfg.slotDurationMin}
        backHref="/"
      />
      <Footer
        githubUrl={cfg.githubUrl}
        hidden={cfg.hideBranding}
        version={cfg.version}
      />
    </div>
  );
});
