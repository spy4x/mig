import { Logo } from "./Logo.tsx";
import ThemeToggle from "../islands/ThemeToggle.tsx";

/*
  Top app chrome. Slim, single-line, fixed at the top of the page with
  a hairline border. On mobile we collapse to just the logo + toggle;
  the host name + tz show up below in the hero block.
*/

interface HeaderProps {
  hostName: string;
  hostTz: string;
  compact?: boolean;
}

function shortTz(tz: string): string {
  // "Europe/Berlin" → "Berlin". Falls back to the raw string for weird
  // tz values that have no slash (e.g. "UTC").
  const parts = tz.split("/");
  return parts[parts.length - 1]?.replace(/_/g, " ") ?? tz;
}

export function Header({ hostName, hostTz, compact = false }: HeaderProps) {
  return (
    <header
      class={`sticky top-0 z-40 w-full border-b border-line bg-surface/85 backdrop-blur-md backdrop-saturate-150 ${
        compact ? "" : ""
      }`}
    >
      <div class="mx-auto flex w-full max-w-2xl items-center justify-between px-4 sm:px-6 py-3">
        <div class="flex items-center gap-2.5">
          <Logo size={26} href="/" />
          {!compact && (
            <span class="hidden sm:inline-flex items-center gap-2 text-sm text-ink-muted">
              <span class="h-3 w-px bg-line" />
              <span class="truncate max-w-[12rem]">{hostName}</span>
              <span class="text-ink-subtle">·</span>
              <span class="text-ink-subtle">{shortTz(hostTz)}</span>
            </span>
          )}
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
