import { useEffect, useState } from "preact/hooks";

/*
  Theme toggle island.

  Cycles through auto → light → dark → auto. The actual mutation lives
  in `window.__migTheme` (set up by lib/theme.ts at first paint), so
  the button just calls into that — no class juggling here.

  Why a cycle, not a tri-state dropdown: the affordance is small (one
  icon button in the header). A cycle lets the user see + control the
  setting without ever opening a popover. The order is auto first
  because that's the safe default.

  Why "auto" is rendered with the moon icon: it follows the system, so
  we show whichever the OS currently is. Sun = light, moon = dark, the
  half-moon "auto" icon = following.
*/

type Mode = "light" | "dark" | "auto";

declare global {
  var __migTheme: {
    mode: () => Mode;
    apply: (m: Mode) => Mode;
  } | undefined;
}

function nextMode(m: Mode): Mode {
  return m === "auto" ? "light" : m === "light" ? "dark" : "auto";
}

function label(m: Mode): string {
  return m === "auto"
    ? "Theme: follows system. Click for light."
    : m === "light"
    ? "Theme: light. Click for dark."
    : "Theme: dark. Click for auto.";
}

function Icon({ mode }: { mode: Mode }) {
  // 18×18 line icons. Stroke uses currentColor so they ride the
  // brand/text colour tokens.
  if (mode === "light") {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m4.93 19.07 1.41-1.41" />
        <path d="m17.66 6.34 1.41-1.41" />
      </svg>
    );
  }
  if (mode === "dark") {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    );
  }
  // auto: half-light half-dark split circle
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function ThemeToggle() {
  // We can't read localStorage during SSR, so we render a stable
  // "auto" placeholder until hydration. After hydration we sync to
  // the real mode and start responding to clicks + system changes.
  const [mode, setMode] = useState<Mode>("auto");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const api = globalThis.__migTheme;
    if (api) setMode(api.mode());
  }, []);

  function onClick() {
    const api = globalThis.__migTheme;
    if (!api) return;
    const next = nextMode(mode);
    api.apply(next);
    setMode(next);
  }

  // Until mounted, render a placeholder with the same dimensions so the
  // layout doesn't shift when the real button hydrates.
  const base =
    "relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface-raised text-ink-muted hover:text-ink hover:bg-surface-sunken transition-colors duration-(--duration-snappy) focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Toggle theme"
        class={`${base} opacity-0`}
        tabIndex={-1}
      >
        <Icon mode="auto" />
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label={label(mode)}
      title={label(mode)}
      onClick={onClick}
      class={base}
    >
      <Icon mode={mode} />
    </button>
  );
}
