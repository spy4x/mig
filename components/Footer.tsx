/*
  Footer. Hidden when HIDE_BRANDING is true (config-driven, not env).

  Kept minimal — a single line with the "Powered by mig vX.Y.Z"
  attribution and an "embed" link. No socials, no language picker.
  The page is supposed to feel personal, not corporate.

  The build version is rendered inline with the attribution so the
  host can confirm at a glance which build is live without a
  separate chip. Pass either "0.2.0" or "v0.2.0" — the `v` prefix
  is normalised at render time.

  `pb-6` keeps the footer text off the screen edge on short pages
  where the layout doesn't push it down naturally — small enough
  that the footer still feels attached to the content, not floating.
*/

interface FooterProps {
  githubUrl: string;
  hidden?: boolean;
  /** Build identifier (semver recommended, e.g. "0.2.0"). The `v`
   *  prefix is added at render time so callers can pass either with
   *  or without it. Falls back to `"dev"` when unset. */
  version?: string;
}

function formatVersion(raw: string | undefined): string {
  const v = (raw && raw.trim()) || "dev";
  // Strip a leading "v" so callers can pass either "0.2.0" or
  // "v0.2.0" — both should render as "v0.2.0".
  return v.startsWith("v") ? v : `v${v}`;
}

export function Footer(
  { githubUrl, hidden = false, version }: FooterProps,
) {
  if (hidden) return null;
  const v = formatVersion(version);
  return (
    <footer class="mt-16 pt-6 pb-6 border-t border-line">
      <div class="mx-auto max-w-2xl px-4 sm:px-6 flex items-center justify-between text-xs text-ink-subtle">
        <a
          href={githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-ink transition-colors"
        >
          Powered by mig {v}
        </a>
        <a
          href="/embed"
          class="hover:text-ink transition-colors"
          title="Use this on your own site"
        >
          Embed
        </a>
      </div>
    </footer>
  );
}
