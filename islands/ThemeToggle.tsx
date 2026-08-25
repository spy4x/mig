// Theme toggle. Reads localStorage on mount, falls back to OS preference,
// overrides the inline script in <head>. Persists choice.

import { useEffect, useState } from "preact/hooks";

type Mode = "light" | "dark" | "auto";

interface Props {
  initial: Mode;
}

export function ThemeToggle({ initial }: Props) {
  const [mode, setMode] = useState<Mode>(initial);

  useEffect(() => {
    applyMode(mode);
    try {
      if (mode === "auto") localStorage.removeItem("mig-theme");
      else localStorage.setItem("mig-theme", mode);
    } catch {
      // ignore
    }
  }, [mode]);

  // Cycle: auto → light → dark → auto
  function cycle() {
    setMode((m) => (m === "auto" ? "light" : m === "light" ? "dark" : "auto"));
  }

  const label = mode === "auto" ? "auto" : mode;
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Theme: ${label}. Click to change.`}
      title={`Theme: ${label}`}
      class="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
    >
      <ThemeIcon mode={mode} />
    </button>
  );
}

function applyMode(mode: Mode) {
  const html = document.documentElement;
  if (mode === "auto") {
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    html.classList.toggle("dark", dark);
    html.dataset.theme = dark ? "dark" : "light";
  } else if (mode === "dark") {
    html.classList.add("dark");
    html.dataset.theme = "dark";
  } else {
    html.classList.remove("dark");
    html.dataset.theme = "light";
  }
}

function ThemeIcon({ mode }: { mode: Mode }) {
  if (mode === "light") {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
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
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    );
  }
  // auto
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M8 20h8M12 18v2" />
    </svg>
  );
}
