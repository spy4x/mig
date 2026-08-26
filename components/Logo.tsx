// mig wordmark + favicon mark. SVG so it scales crisply at any size and
// inherits `currentColor` for theme integration. The mark is the same
// clock-hand "m" used in /favicon.svg, just rendered at display sizes.

interface LogoProps {
  size?: number;
  withWord?: boolean;
  href?: string;
  class?: string;
}

export function Logo(
  { size = 28, withWord = true, href, class: cls }: LogoProps,
) {
  const svg = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      class={cls}
    >
      <rect
        width="32"
        height="32"
        rx="8"
        fill="currentColor"
        fill-opacity="0.06"
      />
      <g
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M7 22 L7 13" />
        <path d="M7 13 L11 17" />
        <path d="M11 17 L11 22" />
        <path d="M11 17 L25 11" />
      </g>
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
      class="inline-flex items-center hover:opacity-80 transition-opacity"
    >
      {inner}
    </a>
  );
}
