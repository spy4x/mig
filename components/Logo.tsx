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
        d="M7 23 L7 13.5 C7 11.8 7.9 10.5 9.5 10.5 C10.8 10.5 11.8 11.1 12.6 12.1 L16 16.5 L19.4 12.1 C20.2 11.1 21.2 10.5 22.5 10.5 C24.1 10.5 25 11.8 25 13.5 L25 23"
        fill="none"
        stroke="#ffffff"
        stroke-width="2.2"
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
