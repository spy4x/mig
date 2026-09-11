/*
  Single source of truth for every SVG the UI renders. Components
  accept `size`, `strokeWidth`, `className` so callers can match the
  existing visual rhythm (different surface sizes use different
  stroke weights). Default `aria-hidden` is true — wrap the icon in
  a focusable element that carries the accessible name.

  The favicon path (static/favicon.svg) is a copy of `LogoMark`
  baked out as a standalone file because browsers fetch favicons
  before any of our JS runs; keep them in sync if the mark changes.
*/

import type { JSX } from "preact";

interface IconProps extends Omit<JSX.SVGAttributes<SVGSVGElement>, "size"> {
  /** Edge length of the square viewBox. Defaults vary per icon. */
  size?: number | string;
  /** Override stroke-width. Defaults to 2 — most icons look right at
   *  this weight when rendered at the default 16-24px size. */
  strokeWidth?: number | string;
  className?: string;
}

/** Inline a chevron pointing left ("previous"). Used by Calendar's
 *  month nav and a couple of back-link affordances. */
export function ChevronLeft(props: IconProps) {
  const { size = 16, strokeWidth = 2, class: cls, className, ...rest } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={cls ?? className}
      {...rest}
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

/** Inline a chevron pointing right ("next"). Used by Calendar's
 *  month nav. */
export function ChevronRight(props: IconProps) {
  const { size = 16, strokeWidth = 2, class: cls, className, ...rest } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={cls ?? className}
      {...rest}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

/** Horizontal arrow pointing right ("→"). Used by Change links on
 *  DateCard/TimeCard, "Book another time" CTA on /confirmed. */
export function ArrowRight(props: IconProps) {
  const { size = 12, strokeWidth = 2.4, class: cls, className, ...rest } =
    props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={cls ?? className}
      {...rest}
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

/** Horizontal arrow pointing left ("←"). Used by "Book another time"
 *  on /confirmed. */
export function ArrowLeft(props: IconProps) {
  const { size = 12, strokeWidth = 2.2, class: cls, className, ...rest } =
    props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={cls ?? className}
      {...rest}
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

/** Calendar grid (rect + 3 ticks). Used by DateCard and SummaryBar. */
export function Calendar(props: IconProps) {
  const { size = 16, strokeWidth = 2, class: cls, className, ...rest } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={cls ?? className}
      {...rest}
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

/** Clock face (circle + hour hand). Used by TimeCard. */
export function Clock(props: IconProps) {
  const { size = 16, strokeWidth = 2, class: cls, className, ...rest } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={cls ?? className}
      {...rest}
    >
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 16 14" />
    </svg>
  );
}

/** Filled check (✓) for confirmation success. */
export function Check(props: IconProps) {
  const { size = 26, strokeWidth = 2.4, class: cls, className, ...rest } =
    props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={cls ?? className}
      {...rest}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** Circle with two ticks — info/error-state glyph used on /confirmed
 *  and /cancel when the link is missing / invalid. */
export function InfoCircle(props: IconProps) {
  const { size = 22, strokeWidth = 1.8, class: cls, className, ...rest } =
    props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={cls ?? className}
      {...rest}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

/** Horizontal X — used on /confirmed "Booking cancelled" view. */
export function Minus(props: IconProps) {
  const { size = 26, strokeWidth = 1.8, class: cls, className, ...rest } =
    props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={cls ?? className}
      {...rest}
    >
      <path d="M5 12h14" />
    </svg>
  );
}

/** Quarter-arc spinner — animated via `animate-spin` on the parent. */
export function Spinner(props: IconProps) {
  const { size = 16, strokeWidth = 2.5, class: cls, className, ...rest } =
    props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      aria-hidden="true"
      class={cls ?? className ?? "animate-spin"}
      {...rest}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

/** Sun — used by the theme toggle (light mode). */
export function Sun(props: IconProps) {
  const { size = 18, strokeWidth = 1.8, class: cls, className, ...rest } =
    props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={cls ?? className}
      {...rest}
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

/** Moon — used by the theme toggle (dark mode). */
export function Moon(props: IconProps) {
  const { size = 18, strokeWidth = 1.8, class: cls, className, ...rest } =
    props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={cls ?? className}
      {...rest}
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

/** Half-light half-dark split circle — used by the theme toggle
 *  (auto mode). The right half is `fill="currentColor"` (no stroke)
 *  so it reads as "currently light" or "currently dark" depending
 *  on the OS colour scheme. */
export function ThemeAuto(props: IconProps) {
  const { size = 18, strokeWidth = 1.8, class: cls, className, ...rest } =
    props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={cls ?? className}
      {...rest}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </svg>
  );
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
