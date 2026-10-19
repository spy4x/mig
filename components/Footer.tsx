/*
  Footer. Hidden when HIDE_BRANDING is true (config-driven, not env).

  Kept minimal — a single line with the "Powered by mig vX.Y.Z"
  attribution and an "embed" link. No socials, no language picker.
  The page is supposed to feel personal, not corporate.

  The build version is rendered inline with the attribution so the
  host can confirm at a glance which build is live without a
  separate chip. Pass either "0.2.0" or "v0.2.0" — the `v` prefix
  is normalised at render time.

  Each link is a 44 px touch target on a phone, so the row needs no
  extra padding to sit off the screen edge.
*/

interface FooterProps {
  githubUrl: string
  hidden?: boolean
  /** Build identifier (semver recommended, e.g. "0.2.0"). The `v`
   *  prefix is added at render time so callers can pass either with
   *  or without it. Falls back to `"dev"` when unset. */
  version?: string
}

function formatVersion(raw: string | undefined): string {
  const v = (raw && raw.trim()) || "dev"
  // Strip a leading "v" so callers can pass either "0.2.0" or
  // "v0.2.0" — both should render as "v0.2.0".
  return v.startsWith("v") ? v : `v${v}`
}

export function Footer(
  { githubUrl, hidden = false, version }: FooterProps,
) {
  if (hidden) return null
  const v = formatVersion(version)
  return (
    <footer class="mt-16 border-t border-subtle">
      <div class="mx-auto flex max-w-2xl items-center justify-between px-4 py-2 text-xs text-muted sm:px-6">
        <a
          href={githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          class={LINK}
        >
          Powered by mig {v}
        </a>
        <a href="/embed" class={LINK} title="Use this on your own site">
          Embed
        </a>
      </div>
    </footer>
  )
}

/** A quiet footer link: 44 px tall on a phone, 36 px with a pointer, the library's focus ring. */
const LINK =
  "inline-flex min-h-11 items-center rounded-md px-1 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-focus focus-visible:outline-hidden sm:min-h-9"
