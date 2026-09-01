/*
  Footer. Hidden when HIDE_BRANDING is true (config-driven, not env).

  Kept minimal — a single line with the "Powered by mig" attribution
  and an "embed" link. No socials, no language picker. The page is
  supposed to feel personal, not corporate.

  The version chip (e.g. "mig vabc1234") sits between the attribution
  and the embed link so a fresh agent (or the host) can confirm at a
  glance which build is live. The chip is rendered even when
  HIDE_BRANDING is true — branding and build traceability are
  separate concerns. It always renders because it's useful diagnostic
  info, not advertising.

  `pb-6` keeps the footer text off the screen edge on short pages
  where the layout doesn't push it down naturally — small enough
  that the footer still feels attached to the content, not floating.
*/

interface FooterProps {
  githubUrl: string;
  hidden?: boolean;
  version?: string;
}

export function Footer(
  { githubUrl, hidden = false, version }: FooterProps,
) {
  const v = (version && version.trim()) || "dev";
  // The version chip is diagnostic info (which build is live?) so it
  // renders even when `hidden=true` — branding is an advertising
  // concern, build traceability is a separate operational one. The
  // rest of the chrome (Powered-by + Embed) is suppressed on hide.
  return (
    <footer class="mt-16 pt-6 pb-6 border-t border-line">
      <div class="mx-auto max-w-2xl px-4 sm:px-6 flex items-center justify-between text-xs text-ink-subtle">
        {hidden ? <span /> : (
          <a
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="hover:text-ink transition-colors"
          >
            Powered by mig
          </a>
        )}
        <span
          class="font-mono text-[11px] text-ink-subtle/80 select-all"
          title={`Build identifier — set via MIG_VERSION env at build time. Currently: ${v}`}
        >
          mig v{v}
        </span>
        {hidden ? <span /> : (
          <a
            href="/embed"
            class="hover:text-ink transition-colors"
            title="Use this on your own site"
          >
            Embed
          </a>
        )}
      </div>
    </footer>
  );
}
