// mig wordmark + favicon mark. SVG so it scales crisply at any size.
// Inherits `currentColor` so it themes correctly in light/dark mode.
// Same path as /favicon.svg, rendered at display size.

interface LogoProps {
  size?: number;
  withWord?: boolean;
  href?: string;
  class?: string;
}

export function Logo({
  size = 28,
  withWord = true,
  href,
  class: cls,
}: LogoProps) {
  const svg = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      class={cls}
    >
      <rect width="32" height="32" rx="8" fill="#fb923c" />
      <path
        d="M8 23 L8 14 L12 18 L16 14 L16 23"
        fill="none"
        stroke="#ffffff"
        stroke-width="2.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );

  if (!withWord) return svg;

  const inner = (
    <span class="inline-flex items-center gap-2 font-semibold tracking-(--tracking-tight) text-ink">
      {svg}
      <span class="text-[15px]">mig</span>
    </span>
  );

  if (!href) return inner;
  return (
    <a
      href={href}
      class="inline-flex items-center hover:opacity-80 transition-opacity focus:outline-none focus-visible:opacity-80"
    >
      {inner}
    </a>
  );
}
