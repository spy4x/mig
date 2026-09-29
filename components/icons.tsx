/*
  mig's brand mark. Every other glyph comes from @spy4x/preact-icons.

  The favicon path (static/favicon.svg) is a copy of `LogoMark`
  baked out as a standalone file because browsers fetch favicons
  before any of our JS runs; keep them in sync if the mark changes.
*/

import type { JSX } from "preact";

interface IconProps extends Omit<JSX.SVGAttributes<SVGSVGElement>, "size"> {
  /** Edge length of the square viewBox. */
  size?: number | string;
  className?: string;
}

/** mig wordmark — square "M" on an orange tile, white stroke.
 *  Lives in `static/favicon.svg` as a baked-out copy for the
 *  browser's pre-JS favicon fetch. Keep the two in sync. */
export function LogoMark(props: IconProps) {
  const { size = 32, class: cls, className, ...rest } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      class={cls ?? className}
      {...rest}
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
}
