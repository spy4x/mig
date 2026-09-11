// mig wordmark + favicon mark. The mark itself is in icons.tsx so
// the brand colour lives in one place; this file is just the chrome
// around it (word label + optional link wrapper).

import { LogoMark } from "./icons.tsx";

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
  const svg = <LogoMark size={size} className={cls} />;

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
